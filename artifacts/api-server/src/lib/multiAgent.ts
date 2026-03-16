import { EventEmitter } from "events";
import { ChatMessage } from "./ollamaClient.js";
import { TaskPlan, PlanStep } from "./planner.js";
import { memorySystem } from "./memory.js";

export type AgentRole = "planner" | "browser" | "coder" | "researcher" | "reviewer" | "general";

export interface AgentActivity {
  agentRole: AgentRole;
  stepId: number;
  status: "idle" | "thinking" | "acting" | "done" | "failed";
  message: string;
  timestamp: Date;
}

const AGENT_SYSTEM_PROMPTS: Record<AgentRole, string> = {
  planner: `أنت وكيل التخطيط في CortexFlow. مهمتك تحليل الأهداف وإنشاء خطط تنفيذ مفصلة.
تفكيرك منظم ومنطقي. تضع خطوات واضحة ومتسلسلة. تراعي الاعتماديات بين الخطوات.`,

  browser: `أنت وكيل المتصفح في CortexFlow. متخصص في التصفح والتفاعل مع المواقع.
تعمل بدقة وتتحقق من كل خطوة. تتعامل مع الأخطاء بذكاء.`,

  coder: `أنت وكيل البرمجة في CortexFlow. متخصص في كتابة كود نظيف وفعال.
تحلل المتطلبات قبل الكتابة. تكتب كوداً موثقاً ومنظماً.`,

  researcher: `أنت وكيل البحث في CortexFlow. متخصص في جمع وتحليل المعلومات.
تبحث من مصادر متعددة وتقدم معلومات دقيقة وموثوقة.`,

  reviewer: `أنت وكيل المراجعة في CortexFlow. تراجع وتتحقق من جودة النتائج.
تقدم ملاحظات بناءة وتضمن اكتمال المهمة.`,

  general: `أنت وكيل عام في CortexFlow. تتعامل مع المهام المتنوعة باحترافية.
تفهم المتطلبات جيداً وتنفذ بدقة.`,
};

export class MultiAgentOrchestrator extends EventEmitter {
  private activeAgents: Map<string, AgentRole> = new Map();

  emitAgentActivity(taskId: string, activity: AgentActivity) {
    this.emit("agentActivity", { taskId, ...activity });
  }

  async executeStep(
    taskId: string,
    step: PlanStep,
    goal: string,
    previousResults: Record<number, string>,
    smartChat: (messages: ChatMessage[], opts?: any, stepName?: string) => Promise<string>,
  ): Promise<string> {
    const agentRole = step.agent;
    this.activeAgents.set(taskId, agentRole);

    this.emitAgentActivity(taskId, {
      agentRole,
      stepId: step.id,
      status: "thinking",
      message: `${getAgentName(agentRole)} يفكر في: ${step.title}`,
      timestamp: new Date(),
    });

    const systemPrompt = AGENT_SYSTEM_PROMPTS[agentRole];
    const memoryContext = memorySystem.getSessionContext(taskId);
    const longTermContext = memorySystem.buildContextFromMemory(goal);

    const prevResultsSummary = Object.entries(previousResults)
      .map(([id, res]) => `خطوة ${id}: ${res.substring(0, 200)}`)
      .join("\n");

    const contextParts = [
      `الهدف الرئيسي: ${goal}`,
      prevResultsSummary ? `نتائج الخطوات السابقة:\n${prevResultsSummary}` : "",
      memoryContext,
      longTermContext,
    ].filter(Boolean).join("\n\n");

    const userMessage = [
      contextParts,
      `\nالمهمة الحالية (خطوة ${step.id}): ${step.title}`,
      `التفاصيل: ${step.description}`,
      `\nنفّذ هذه الخطوة وقدّم نتيجة مفصلة.`,
    ].filter(Boolean).join("\n");

    this.emitAgentActivity(taskId, {
      agentRole,
      stepId: step.id,
      status: "acting",
      message: `${getAgentName(agentRole)} يُنفّذ: ${step.description}`,
      timestamp: new Date(),
    });

    const result = await smartChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      { temperature: 0.4, max_tokens: 800 },
      `AGENT_${agentRole.toUpperCase()}`,
    );

    memorySystem.addStepResult(taskId, `خطوة ${step.id}`, result);

    this.emitAgentActivity(taskId, {
      agentRole,
      stepId: step.id,
      status: "done",
      message: `${getAgentName(agentRole)} أكمل: ${step.title}`,
      timestamp: new Date(),
    });

    this.activeAgents.delete(taskId);
    return result;
  }

  async runReviewPhase(
    taskId: string,
    goal: string,
    allResults: Record<number, string>,
    smartChat: (messages: ChatMessage[], opts?: any) => Promise<string>,
  ): Promise<string> {
    this.emitAgentActivity(taskId, {
      agentRole: "reviewer",
      stepId: 99,
      status: "thinking",
      message: "وكيل المراجعة يراجع جميع النتائج...",
      timestamp: new Date(),
    });

    const resultsSummary = Object.entries(allResults)
      .map(([id, res]) => `خطوة ${id}:\n${res.substring(0, 300)}`)
      .join("\n\n");

    const review = await smartChat(
      [
        { role: "system", content: AGENT_SYSTEM_PROMPTS.reviewer },
        {
          role: "user",
          content: `الهدف: ${goal}\n\nنتائج جميع الخطوات:\n${resultsSummary}\n\nقدّم ملخصاً نهائياً شاملاً ومنظماً للإنجازات.`,
        },
      ],
      { temperature: 0.3, max_tokens: 500 },
    );

    this.emitAgentActivity(taskId, {
      agentRole: "reviewer",
      stepId: 99,
      status: "done",
      message: "اكتملت المراجعة النهائية",
      timestamp: new Date(),
    });

    return review;
  }

  getActiveAgent(taskId: string): AgentRole | null {
    return this.activeAgents.get(taskId) || null;
  }
}

export function getAgentName(role: AgentRole): string {
  const names: Record<AgentRole, string> = {
    planner: "وكيل التخطيط",
    browser: "وكيل المتصفح",
    coder: "وكيل البرمجة",
    researcher: "وكيل البحث",
    reviewer: "وكيل المراجعة",
    general: "الوكيل العام",
  };
  return names[role] || role;
}

export function getAgentEmoji(role: AgentRole): string {
  const emojis: Record<AgentRole, string> = {
    planner: "🧠",
    browser: "🌐",
    coder: "💻",
    researcher: "🔍",
    reviewer: "✅",
    general: "⚡",
  };
  return emojis[role] || "🤖";
}

export const multiAgentOrchestrator = new MultiAgentOrchestrator();
