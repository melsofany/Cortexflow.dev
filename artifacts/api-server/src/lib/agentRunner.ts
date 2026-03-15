import { EventEmitter } from "events";
import { ollamaClient, ChatMessage } from "./ollamaClient.js";
import { taskStore, Task } from "./taskStore.js";
import { browserAgent } from "./browserAgent.js";
import { selectBestModel, formatModelSelection, TaskCategory } from "./modelSelector.js";

const MAX_ITERATIONS = 20;

const ACTION_SYSTEM_PROMPT = `أنت وكيل متصفح. مهمتك تنفيذ المهام خطوة بخطوة حتى الاكتمال الكامل.

في كل رد، اكتب سطراً واحداً فقط بهذا الشكل:
ACTION: <الإجراء> | PARAM: <المعامل>

الإجراءات المتاحة:
- navigate | PARAM: الرابط الكامل
- click | PARAM: نص الزر أو الرابط
- fill | PARAM: اسم_الحقل=القيمة
- type | PARAM: النص المراد كتابته
- key | PARAM: اسم المفتاح (Enter, Tab, Escape)
- scroll | PARAM: up أو down
- wait | PARAM: انتظار
- done | PARAM: وصف ما تم إنجازه

قاعدة: لا تستخدم "done" إلا بعد اكتمال المهمة فعلاً (ليس فقط الوصول للموقع).`;

class AgentRunner extends EventEmitter {
  private systemPrompt = `أنت CortexFlow، وكيل ذكاء اصطناعي يتحكم في المتصفح.
نفّذ المهام خطوة بخطوة حتى الاكتمال الكامل. رد بإيجاز بنفس لغة المستخدم.`;

  async executeTask(task: Task): Promise<void> {
    const start = Date.now();
    taskStore.updateTask(task.taskId, { status: "running" });
    this.emit("taskStart", { taskId: task.taskId, description: task.description });

    try {
      // ── Smart Model Selection ─────────────────────────────────────────────
      const { model, category, reason } = await selectBestModel(
        task.description,
        task.type
      );

      const selectionMsg = formatModelSelection(model, category, reason);
      this.emitStep(task.taskId, "MODEL", selectionMsg);
      await sleep(200);

      if (task.type === "browser") {
        await this.executeBrowserTask(task, start, model);
      } else if (ollamaClient.isAvailable()) {
        await this.runWithOllama(task, start, model);
      } else {
        await this.simulateWithSteps(task, start);
      }
    } catch (err: any) {
      const msg = err.message || "Unknown error";
      taskStore.updateTask(task.taskId, { status: "failed", error: msg });
      this.emit("taskFail", { taskId: task.taskId, error: msg });
    }
  }

  private emitStep(taskId: string, step: string, content: string) {
    this.emit("thinking", {
      taskId,
      step,
      content: `[${step}] ${content}`,
      timestamp: new Date(),
    });
    taskStore.addStep(taskId, step, content);
    taskStore.addLog({
      taskId,
      agentType: "AgentRunner",
      action: `step_${step.toLowerCase()}`,
      output: content.substring(0, 300),
    });
  }

  private async executeBrowserTask(task: Task, start: number, model: string): Promise<void> {
    const taskId = task.taskId;

    // ── OBSERVE ────────────────────────────────────────────────────────────
    this.emitStep(taskId, "OBSERVE", `تحليل المهمة: "${task.description}". سأنفذها خطوة بخطوة حتى الاكتمال الكامل.`);
    await sleep(400);

    const ready = await browserAgent.initialize();
    if (!ready) {
      this.emitStep(taskId, "OBSERVE", "تعذّر تشغيل المتصفح. سيتم التنفيذ بوضع المحاكاة.");
      await this.simulateWithSteps(task, start);
      return;
    }

    const chat = (msgs: ChatMessage[], maxTok = 300) =>
      ollamaClient.chat(msgs, { temperature: 0.3, max_tokens: maxTok, model });

    // ── THINK ──────────────────────────────────────────────────────────────
    if (ollamaClient.isAvailable()) {
      const thinkContent = await chat([
        { role: "system", content: this.systemPrompt },
        { role: "user", content: `المهمة: "${task.description}"\nما الموقع المستهدف وما الخطوات الكاملة اللازمة؟` },
      ]).catch(() => "سأنفذ المهمة خطوة بخطوة");
      this.emitStep(taskId, "THINK", thinkContent);
    } else {
      this.emitStep(taskId, "THINK", `التفكير في تنفيذ: "${task.description}"`);
    }
    await sleep(200);

    // ── PLAN ───────────────────────────────────────────────────────────────
    const targetUrl = extractUrl(task.description) || task.url;
    if (ollamaClient.isAvailable()) {
      const planContent = await chat([
        { role: "system", content: this.systemPrompt },
        { role: "user", content: `المهمة: "${task.description}". اذكر الخطوات المتسلسلة الكاملة بإيجاز.` },
      ], 250).catch(() => `الانتقال إلى ${targetUrl || "الموقع"} وتنفيذ جميع الإجراءات`);
      this.emitStep(taskId, "PLAN", planContent);
    } else {
      this.emitStep(taskId, "PLAN", targetUrl
        ? `1. الانتقال إلى ${targetUrl}\n2. تنفيذ الإجراءات المطلوبة\n3. التحقق من الاكتمال`
        : `1. البحث عن الموقع\n2. تنفيذ المهمة\n3. التحقق`);
    }
    await sleep(200);

    // ── ACT: Agentic Loop ──────────────────────────────────────────────────
    this.emitStep(taskId, "ACT", `بدء التنفيذ التفاعلي بنموذج ${model}...`);
    let finalResult = "";

    if (!ollamaClient.isAvailable()) {
      if (targetUrl) {
        this.emitStep(taskId, "ACT", `الانتقال إلى: ${targetUrl}`);
        await browserAgent.navigate(targetUrl).catch((err: any) =>
          this.emitStep(taskId, "ACT", `تحذير: ${err.message}`)
        );
        finalResult = `تم الانتقال إلى: ${await browserAgent.getCurrentUrl()}.`;
        this.emitStep(taskId, "ACT", finalResult);
      }
    } else {
      const history: ChatMessage[] = [
        { role: "system", content: ACTION_SYSTEM_PROMPT },
      ];

      let iteration = 0;
      while (iteration < MAX_ITERATIONS) {
        iteration++;

        const structure = await browserAgent.getPageStructure();
        const content = await browserAgent.getPageContent();
        const url = await browserAgent.getCurrentUrl();
        const pageState = `URL: ${url}\n${structure}\nمحتوى: ${content.substring(0, 500)}`;

        history.push({
          role: "user",
          content: `المهمة: "${task.description}"\n${pageState}\n\nما الخطوة ${iteration}؟ سطر واحد فقط.`,
        });

        let rawResponse = "";
        try {
          rawResponse = await ollamaClient.chat(history, { temperature: 0.2, max_tokens: 100, model });
          history.push({ role: "assistant", content: rawResponse });
        } catch (err: any) {
          this.emitStep(taskId, "ACT", `خطأ: ${err.message}`);
          break;
        }

        const parsed = parseAction(rawResponse);
        if (!parsed) {
          this.emitStep(taskId, "ACT", `لم أفهم: ${rawResponse.substring(0, 80)}`);
          continue;
        }

        const { action, param } = parsed;
        this.emitStep(taskId, "ACT", `خطوة ${iteration}: ${action} → ${param}`);

        if (action === "done") {
          finalResult = param || "اكتملت المهمة بنجاح";
          break;
        }

        try {
          await executeAction(action, param);
        } catch (err: any) {
          this.emitStep(taskId, "ACT", `تحذير: ${err.message}`);
        }

        await sleep(800);
      }

      if (!finalResult) {
        finalResult = iteration >= MAX_ITERATIONS
          ? `وصل الوكيل للحد الأقصى (${MAX_ITERATIONS} خطوة). آخر موقع: ${await browserAgent.getCurrentUrl()}`
          : `اكتملت العملية. الموقع الأخير: ${await browserAgent.getCurrentUrl()}`;
      }
    }

    // ── VERIFY ─────────────────────────────────────────────────────────────
    let verifyResult = finalResult;
    if (ollamaClient.isAvailable()) {
      const url = await browserAgent.getCurrentUrl();
      verifyResult = await ollamaClient.chat([
        { role: "system", content: "لخّص نتيجة المهمة بجملة أو جملتين." },
        { role: "user", content: `المهمة: "${task.description}"\nالنتيجة: ${finalResult}\nURL: ${url}\nهل اكتملت؟ لخّص.` },
      ], { max_tokens: 150, model }).catch(() => finalResult);
    }

    this.emitStep(taskId, "VERIFY", verifyResult);
    taskStore.updateTask(taskId, { status: "completed", result: verifyResult });
    taskStore.addLog({ taskId, agentType: "AgentRunner", action: "task_complete", output: verifyResult.substring(0, 300), durationMs: Date.now() - start });
    this.emit("taskSuccess", { taskId, result: verifyResult });
  }

  private async runWithOllama(task: Task, start: number, model: string): Promise<void> {
    const steps = ["OBSERVE", "THINK", "PLAN", "ACT", "VERIFY"];
    const prompts: Record<string, string> = {
      OBSERVE: `المهمة: "${task.description}"\nحلّل المتطلبات.`,
      THINK:   `ما أفضل طريقة لتنفيذ المهمة بالكامل؟`,
      PLAN:    `خطة تنفيذ مفصّلة لـ: "${task.description}"`,
      ACT:     `نفّذ المهمة وقدّم النتيجة الفعلية.`,
      VERIFY:  `هل اكتملت المهمة؟ لخّص ما تم.`,
    };
    const messages: ChatMessage[] = [{ role: "system", content: this.systemPrompt }];
    let finalResult = "";

    for (const step of steps) {
      messages.push({ role: "user", content: prompts[step] });
      this.emitStep(task.taskId, step, `...`);
      try {
        const resp = await ollamaClient.chat(messages, { temperature: 0.4, max_tokens: 400, model });
        messages.push({ role: "assistant", content: resp });
        this.emitStep(task.taskId, step, resp);
        if (step === "ACT" || step === "VERIFY") finalResult = resp;
      } catch {
        this.emitStep(task.taskId, step, "جاري المعالجة...");
      }
      await sleep(200);
    }

    taskStore.updateTask(task.taskId, { status: "completed", result: finalResult });
    taskStore.addLog({ taskId: task.taskId, agentType: "AgentRunner", action: "task_complete", output: finalResult.substring(0, 300), durationMs: Date.now() - start });
    this.emit("taskSuccess", { taskId: task.taskId, result: finalResult });
  }

  private async simulateWithSteps(task: Task, start: number): Promise<void> {
    const content: Record<string, string> = {
      OBSERVE: `تحليل المهمة: "${task.description}".`,
      THINK:   `التفكير في طريقة التنفيذ.`,
      PLAN:    `الخطة:\n1. تهيئة الأدوات\n2. تنفيذ الإجراءات\n3. التحقق`,
      ACT:     `وضع المحاكاة. لتفعيل التنفيذ الحقيقي، تأكد من تشغيل Ollama.`,
      VERIFY:  `اكتملت المحاكاة. الوكيل جاهز.`,
    };
    for (const step of ["OBSERVE", "THINK", "PLAN", "ACT", "VERIFY"]) {
      await sleep(500);
      this.emitStep(task.taskId, step, content[step]);
    }
    const result = content["VERIFY"];
    taskStore.updateTask(task.taskId, { status: "completed", result });
    taskStore.addLog({ taskId: task.taskId, agentType: "AgentRunner", action: "task_complete", output: result, durationMs: Date.now() - start });
    this.emit("taskSuccess", { taskId: task.taskId, result });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function parseAction(text: string): { action: string; param: string } | null {
  const m = text.match(/ACTION:\s*(\w+)\s*\|\s*PARAM:\s*(.+)/i);
  if (m) {
    const action = m[1].toLowerCase().trim();
    let param = m[2].trim();
    if (action === "navigate") {
      param = param.replace(/^url:\s*/i, "").trim();
      if (!param.startsWith("http") && !param.startsWith("about:")) {
        param = "https://" + param;
      }
      if (param === "about:blank" || param === "https://about:blank") return null;
    }
    return { action, param };
  }
  if (/\bdone\b/i.test(text)) {
    return { action: "done", param: text.replace(/\bdone\b/i, "").trim() || "اكتملت المهمة" };
  }
  return null;
}

async function executeAction(action: string, param: string): Promise<void> {
  switch (action) {
    case "navigate":
      await browserAgent.navigate(param);
      break;
    case "click":
      await browserAgent.clickByText(param);
      break;
    case "fill": {
      const eqIdx = param.indexOf("=");
      if (eqIdx === -1) break;
      const selector = param.substring(0, eqIdx).trim();
      const value = param.substring(eqIdx + 1).trim();
      await browserAgent.fillField(`#${selector}`, value)
        || await browserAgent.fillField(`[name="${selector}"]`, value)
        || await browserAgent.fillField(`[placeholder*="${selector}"]`, value);
      break;
    }
    case "type":
      await browserAgent.type(param);
      break;
    case "key":
      await browserAgent.pressKey(param);
      break;
    case "scroll":
      await browserAgent.scroll(0, param === "up" ? -400 : 400);
      break;
    case "wait":
      await sleep(2000);
      break;
    default:
      break;
  }
}

function extractUrl(text: string): string | null {
  const siteMap: Record<string, string> = {
    "يوتيوب": "https://www.youtube.com",
    "youtube": "https://www.youtube.com",
    "فيسبوك": "https://www.facebook.com",
    "facebook": "https://www.facebook.com",
    "تويتر": "https://www.twitter.com",
    "twitter": "https://www.twitter.com",
    "جوجل": "https://www.google.com",
    "google": "https://www.google.com",
    "انستجرام": "https://www.instagram.com",
    "instagram": "https://www.instagram.com",
    "جيتهاب": "https://www.github.com",
    "github": "https://www.github.com",
    "لينكدإن": "https://www.linkedin.com",
    "linkedin": "https://www.linkedin.com",
  };
  for (const [key, url] of Object.entries(siteMap)) {
    if (text.toLowerCase().includes(key.toLowerCase())) return url;
  }
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) return urlMatch[0];
  const domainMatch = text.match(/(?:افتح|اذهب إلى|تصفح|موقع)\s+([a-z0-9.-]+\.[a-z]{2,})/i);
  if (domainMatch) return `https://${domainMatch[1]}`;
  return null;
}

export const agentRunner = new AgentRunner();
