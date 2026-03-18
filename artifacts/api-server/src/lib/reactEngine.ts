/**
 * reactEngine.ts — محرك ReAct (Reasoning + Acting)
 * ─────────────────────────────────────────────────────────────────────────────
 * مستوحى من Manus AI: حلقة Thought → Action → Observation صريحة
 *   1. التفكير (Thought): تحليل الموقف وتحديد الخطوة التالية
 *   2. الفعل (Action): اختيار وتنفيذ الأداة المناسبة
 *   3. الملاحظة (Observation): تحليل نتيجة الفعل
 *   4. التكيّف: تعديل الاستراتيجية بناءً على الملاحظات
 *   5. التحقق الذاتي: التأكد من اكتمال المهمة بنجاح
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from "events";
import { toolOrchestrator, ToolName } from "./toolOrchestrator.js";
import { contextManager } from "./contextManager.js";

export interface ReActStep {
  stepNumber: number;
  thought: string;
  action: {
    tool: ToolName;
    input: Record<string, unknown>;
    reasoning: string;
  };
  observation: string;
  isComplete: boolean;
  confidence: number;
  timestamp: Date;
}

export interface ReActSession {
  taskId: string;
  goal: string;
  steps: ReActStep[];
  finalAnswer: string;
  success: boolean;
  totalSteps: number;
  startedAt: Date;
  completedAt?: Date;
}

export interface ReActConfig {
  maxSteps: number;
  maxRetries: number;
  requireVerification: boolean;
  parallelAllowed: boolean;
}

const DEFAULT_CONFIG: ReActConfig = {
  maxSteps: 10,
  maxRetries: 2,
  requireVerification: true,
  parallelAllowed: true,
};

// ══════════════════════════════════════════════════════════════════════════════
// نظام الاستدلال الإلزامي (Mandatory Reasoning)
// ══════════════════════════════════════════════════════════════════════════════

const REACT_SYSTEM_PROMPT = `أنت وكيل ذكاء اصطناعي متقدم يعمل بنمط ReAct (Reasoning + Acting).

في كل خطوة، يجب أن تتبع هذا التنسيق الصارم:

**THOUGHT:** [تفكيرك في الموقف الحالي — ماذا تعلم، ماذا تحتاج، ما الخطوة التالية]
**ACTION:** [الأداة التي ستستخدمها: web_search / execute_code / calculate / browser_navigate / write_file / read_file / shell_run / none]
**ACTION_INPUT:** [المدخلات للأداة بتنسيق JSON]
**OBSERVATION_NEEDED:** [ما الذي ستبحث عنه في النتيجة]

إذا اكتملت المهمة:
**FINAL_ANSWER:** [الإجابة الكاملة والنهائية]
**CONFIDENCE:** [0.0 إلى 1.0]
**COMPLETE:** true

قواعد مهمة:
- فكّر قبل أي فعل
- استخدم أداة واحدة فقط في كل خطوة
- لا تخمّن — استخدم الأدوات للتحقق
- لا تكرر نفس الفعل إذا فشل — جرّب استراتيجية مختلفة
- اكتمل فقط عندما تكون متأكداً من صحة النتيجة`;

const REACT_VERIFY_PROMPT = `مراجعة النتيجة النهائية:
1. هل أجبت على الهدف الأصلي بالكامل؟
2. هل النتيجة دقيقة وموثوقة؟
3. هل هناك شيء ناقص؟

إذا كانت الإجابة مكتملة: أجب بـ "VERIFIED: نعم — [سبب]"
إذا كانت غير مكتملة: أجب بـ "INCOMPLETE: [ما الناقص]"`;

// ══════════════════════════════════════════════════════════════════════════════
// محلّل استجابة ReAct
// ══════════════════════════════════════════════════════════════════════════════

interface ParsedReActResponse {
  thought: string;
  action: ToolName;
  actionInput: Record<string, unknown>;
  observationNeeded: string;
  finalAnswer?: string;
  confidence: number;
  isComplete: boolean;
}

function parseReActResponse(response: string): ParsedReActResponse {
  const extract = (key: string): string => {
    const regex = new RegExp(`\\*\\*${key}:\\*\\*\\s*([\\s\\S]*?)(?=\\*\\*[A-Z_]+:\\*\\*|$)`, 'i');
    const match = response.match(regex);
    return match ? match[1].trim() : "";
  };

  const thought = extract("THOUGHT") || extract("تفكير") || "جاري التحليل...";
  const actionStr = extract("ACTION") || extract("الفعل") || "none";
  const actionInputStr = extract("ACTION_INPUT") || extract("مدخلات الفعل") || "{}";
  const observationNeeded = extract("OBSERVATION_NEEDED") || extract("الملاحظة المطلوبة") || "";
  const finalAnswer = extract("FINAL_ANSWER") || extract("الإجابة النهائية") || "";
  const confidenceStr = extract("CONFIDENCE") || "0.5";
  const completeStr = extract("COMPLETE") || extract("مكتمل") || "";

  const toolNames: ToolName[] = [
    "web_search", "execute_code", "browser_navigate", "browser_screenshot",
    "read_file", "write_file", "calculate", "shell_run", "summarize_text", "extract_info", "none"
  ];

  let action: ToolName = "none";
  const actionLower = actionStr.toLowerCase();
  for (const t of toolNames) {
    if (actionLower.includes(t)) { action = t; break; }
  }

  let actionInput: Record<string, unknown> = {};
  try {
    const jsonMatch = actionInputStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) actionInput = JSON.parse(jsonMatch[0]);
    else if (actionInputStr.trim()) actionInput = { query: actionInputStr.trim() };
  } catch {}

  const confidence = Math.min(1, Math.max(0, parseFloat(confidenceStr) || 0.5));
  const isComplete = completeStr.toLowerCase().includes("true") || finalAnswer.length > 20;

  return { thought, action, actionInput, observationNeeded, finalAnswer, confidence, isComplete };
}

// ══════════════════════════════════════════════════════════════════════════════
// فئة محرك ReAct
// ══════════════════════════════════════════════════════════════════════════════

export class ReActEngine extends EventEmitter {
  private sessions: Map<string, ReActSession> = new Map();

  async runReActLoop(
    taskId: string,
    goal: string,
    smartChat: (messages: Array<{role: string; content: string}>, opts?: Record<string, unknown>) => Promise<string>,
    config: Partial<ReActConfig> = {},
  ): Promise<ReActSession> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const session: ReActSession = {
      taskId,
      goal,
      steps: [],
      finalAnswer: "",
      success: false,
      totalSteps: 0,
      startedAt: new Date(),
    };

    this.sessions.set(taskId, session);
    contextManager.initContext(taskId, goal);

    this.emit("sessionStart", { taskId, goal });

    let stepNum = 0;
    let consecutiveFailures = 0;
    const usedTools: Set<string> = new Set();

    while (stepNum < cfg.maxSteps) {
      stepNum++;
      const contextStr = contextManager.buildContextString(taskId);

      // بناء رسالة المستخدم
      const previousStepsText = session.steps.length > 0
        ? "الخطوات السابقة:\n" + session.steps.slice(-3).map(s =>
            `[خطوة ${s.stepNumber}]\nالتفكير: ${s.thought.substring(0, 200)}\nالملاحظة: ${s.observation.substring(0, 200)}`
          ).join("\n\n")
        : "";

      const userMessage = [
        `الهدف: ${goal}`,
        contextStr ? `\nالسياق:\n${contextStr}` : "",
        previousStepsText ? `\n${previousStepsText}` : "",
        `\nالخطوة الحالية: ${stepNum}/${cfg.maxSteps}`,
        consecutiveFailures > 0 ? `\n⚠️ تحذير: فشلت ${consecutiveFailures} خطوات متتالية — جرّب نهجاً مختلفاً` : "",
        `\nاتبع تنسيق ReAct الصارم وأخبرني بالخطوة التالية.`,
      ].filter(Boolean).join("\n");

      this.emit("stepThinking", { taskId, stepNum });

      let response = "";
      try {
        response = await smartChat(
          [
            { role: "system", content: REACT_SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
          { temperature: 0.3, max_tokens: 800 },
        );
      } catch (e) {
        response = `**THOUGHT:** خطأ في الاتصال\n**ACTION:** none\n**ACTION_INPUT:** {}\n**FINAL_ANSWER:** حدث خطأ أثناء معالجة الطلب\n**COMPLETE:** true`;
      }

      const parsed = parseReActResponse(response);

      // تنفيذ الأداة
      let observation = "";
      if (parsed.isComplete && parsed.finalAnswer) {
        observation = `اكتملت المهمة. الإجابة النهائية جاهزة.`;
      } else if (parsed.action && parsed.action !== "none") {
        this.emit("stepActing", { taskId, stepNum, tool: parsed.action });

        const toolResult = await toolOrchestrator.execute(
          taskId,
          parsed.action,
          parsed.actionInput,
          parsed.thought,
        );

        observation = toolResult.success
          ? toolResult.output
          : `[فشل] ${toolResult.output}`;

        usedTools.add(parsed.action);
        consecutiveFailures = toolResult.success ? 0 : consecutiveFailures + 1;
      } else {
        observation = "لا توجد أداة — الاستجابة مباشرة";
        consecutiveFailures = 0;
      }

      // تسجيل الخطوة
      const step: ReActStep = {
        stepNumber: stepNum,
        thought: parsed.thought,
        action: {
          tool: parsed.action,
          input: parsed.actionInput,
          reasoning: parsed.observationNeeded,
        },
        observation,
        isComplete: parsed.isComplete,
        confidence: parsed.confidence,
        timestamp: new Date(),
      };

      session.steps.push(step);
      session.totalSteps = stepNum;

      // تحديث السياق
      contextManager.addMessage(taskId, "assistant", `خطوة ${stepNum}: ${parsed.thought.substring(0, 200)}`);
      contextManager.addMessage(taskId, "system", `ملاحظة: ${observation.substring(0, 200)}`);

      this.emit("stepComplete", { taskId, step });

      // التحقق من الاكتمال
      if (parsed.isComplete && parsed.finalAnswer) {
        // التحقق الذاتي
        if (cfg.requireVerification && parsed.confidence < 0.9) {
          const verifyResult = await this.verifySolution(taskId, goal, parsed.finalAnswer, smartChat);
          if (!verifyResult.verified) {
            contextManager.addToWorkingMemory(taskId, `⚠️ التحقق: ${verifyResult.reason}`);
            if (verifyResult.canContinue) continue;
          }
        }

        session.finalAnswer = parsed.finalAnswer;
        session.success = true;
        session.completedAt = new Date();
        this.emit("sessionComplete", { taskId, session });
        break;
      }

      // إنهاء إذا فشلنا كثيراً
      if (consecutiveFailures >= cfg.maxRetries + 1) {
        session.finalAnswer = this.buildPartialAnswer(session);
        session.success = false;
        session.completedAt = new Date();
        break;
      }
    }

    if (!session.completedAt) {
      session.finalAnswer = this.buildPartialAnswer(session);
      session.success = session.steps.some(s => s.isComplete);
      session.completedAt = new Date();
    }

    contextManager.clearSession(taskId);
    return session;
  }

  private async verifySolution(
    taskId: string,
    goal: string,
    answer: string,
    smartChat: (messages: Array<{role: string; content: string}>, opts?: Record<string, unknown>) => Promise<string>,
  ): Promise<{ verified: boolean; reason: string; canContinue: boolean }> {
    try {
      const verifyMsg = `الهدف: ${goal}\n\nالإجابة المقترحة:\n${answer.substring(0, 500)}\n\n${REACT_VERIFY_PROMPT}`;
      const result = await smartChat(
        [{ role: "user", content: verifyMsg }],
        { temperature: 0.2, max_tokens: 300 },
      );

      const verified = result.toLowerCase().includes("verified:") || result.includes("نعم");
      const reason = result.substring(0, 200);
      return { verified, reason, canContinue: !verified };
    } catch {
      return { verified: true, reason: "تجاوز التحقق", canContinue: false };
    }
  }

  private buildPartialAnswer(session: ReActSession): string {
    const completedSteps = session.steps.filter(s => s.observation && s.observation.length > 10);
    if (completedSteps.length === 0) return "لم أتمكن من إكمال المهمة.";

    const lastStep = completedSteps[completedSteps.length - 1];
    return [
      `بناءً على ${completedSteps.length} خطوة:`,
      lastStep.observation.substring(0, 600),
      session.steps.length >= 10 ? "\n[تجاوزت عدد الخطوات المسموح به]" : "",
    ].filter(Boolean).join("\n");
  }

  getSession(taskId: string): ReActSession | undefined {
    return this.sessions.get(taskId);
  }

  formatSessionForDisplay(session: ReActSession): string {
    const parts = [`🎯 الهدف: ${session.goal}\n`];

    session.steps.forEach(s => {
      parts.push(`**خطوة ${s.stepNumber}:**`);
      parts.push(`💭 ${s.thought.substring(0, 200)}`);
      if (s.action.tool !== "none") {
        parts.push(`🔧 أداة: ${s.action.tool}`);
      }
      parts.push(`👁️ ${s.observation.substring(0, 200)}`);
      parts.push("");
    });

    if (session.finalAnswer) {
      parts.push(`✅ **النتيجة النهائية:**\n${session.finalAnswer}`);
    }

    return parts.join("\n");
  }
}

export const reactEngine = new ReActEngine();
