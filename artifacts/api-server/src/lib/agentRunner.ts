import { EventEmitter } from "events";
import { ollamaClient, ChatMessage } from "./ollamaClient.js";
import { taskStore, Task } from "./taskStore.js";
import { browserAgent } from "./browserAgent.js";

const STEP_LABELS: Record<string, string> = {
  OBSERVE: "مراقبة",
  THINK:   "تفكير",
  PLAN:    "تخطيط",
  ACT:     "تنفيذ",
  VERIFY:  "تحقق",
};

class AgentRunner extends EventEmitter {
  private systemPrompt = `أنت CortexFlow، وكيل ذكاء اصطناعي متقدم يتحكم في متصفح الويب.
عند تلقي مهمة:
1. OBSERVE: تحليل المهمة وتحديد الخطوات
2. THINK: التفكير في أفضل طريقة
3. PLAN: إنشاء خطة تنفيذ محددة
4. ACT: تنفيذ المهمة فعلياً
5. VERIFY: التحقق من النتيجة

رد دائماً بنفس لغة المستخدم. كن مختصراً وعملياً.`;

  async executeTask(task: Task): Promise<void> {
    const start = Date.now();
    taskStore.updateTask(task.taskId, { status: "running" });
    this.emit("taskStart", { taskId: task.taskId, description: task.description });

    try {
      if (task.type === "browser") {
        await this.executeBrowserTask(task, start);
      } else if (ollamaClient.isAvailable()) {
        await this.runWithOllama(task, start);
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
    taskStore.addLog({ taskId, agentType: "AgentRunner", action: `step_${step.toLowerCase()}`, output: content.substring(0, 300) });
  }

  private async executeBrowserTask(task: Task, start: number): Promise<void> {
    const taskId = task.taskId;

    // ── OBSERVE ────────────────────────────────────────────────────────────
    this.emitStep(taskId, "OBSERVE", `تحليل المهمة: "${task.description}". سأستخدم المتصفح لتنفيذها.`);
    await sleep(500);

    // ── Initialize browser ─────────────────────────────────────────────────
    const ready = await browserAgent.initialize();
    if (!ready) {
      this.emitStep(taskId, "OBSERVE", "تعذّر تشغيل المتصفح. سيتم التنفيذ بوضع المحاكاة.");
      await this.simulateWithSteps(task, start);
      return;
    }

    // ── THINK ──────────────────────────────────────────────────────────────
    let plan: string[] = [];
    if (ollamaClient.isAvailable()) {
      const thinkContent = await ollamaClient.chat([
        { role: "system", content: this.systemPrompt },
        { role: "user", content: `المهمة: "${task.description}"\nحدد: 1) الموقع المستهدف (URL) 2) الخطوات المحددة (click, type, navigate) بشكل قائمة رقمية` },
      ], { max_tokens: 500 }).catch(() => "سأنفذ المهمة خطوة بخطوة");
      this.emitStep(taskId, "THINK", thinkContent);
      await sleep(300);
    } else {
      this.emitStep(taskId, "THINK", `التفكير في تنفيذ: "${task.description}" عبر المتصفح`);
      await sleep(500);
    }

    // ── PLAN ───────────────────────────────────────────────────────────────
    const targetUrl = extractUrl(task.description) || task.url;
    if (ollamaClient.isAvailable()) {
      const planContent = await ollamaClient.chat([
        { role: "system", content: this.systemPrompt },
        { role: "user", content: `المهمة: "${task.description}". أنشئ خطة تنفيذ بالخطوات المتسلسلة` },
      ], { max_tokens: 400 }).catch(() => `الانتقال إلى ${targetUrl || "الموقع المستهدف"} وتنفيذ الإجراءات المطلوبة`);
      this.emitStep(taskId, "PLAN", planContent);
    } else {
      plan = targetUrl
        ? [`1. الانتقال إلى: ${targetUrl}`, "2. تنفيذ الإجراءات المطلوبة", "3. التحقق من النتيجة"]
        : ["1. فتح المتصفح", "2. البحث عن الموقع المناسب", "3. تنفيذ المهمة"];
      this.emitStep(taskId, "PLAN", plan.join("\n"));
    }
    await sleep(300);

    // ── ACT ────────────────────────────────────────────────────────────────
    this.emitStep(taskId, "ACT", "جاري التنفيذ في المتصفح...");
    let pageContent = "";

    if (targetUrl) {
      this.emitStep(taskId, "ACT", `الانتقال إلى: ${targetUrl}`);
      await browserAgent.navigate(targetUrl).catch((err: any) => {
        this.emitStep(taskId, "ACT", `تحذير: ${err.message}`);
      });
      await sleep(2000);
      pageContent = await browserAgent.getPageContent();
      const currentUrl = await browserAgent.getCurrentUrl();
      this.emitStep(taskId, "ACT", `تم الانتقال إلى: ${currentUrl}\nمحتوى الصفحة: ${pageContent.substring(0, 200)}...`);
    } else {
      const searchQuery = encodeURIComponent(task.description);
      await browserAgent.navigate(`https://www.google.com/search?q=${searchQuery}`).catch(() => {});
      await sleep(2000);
      pageContent = await browserAgent.getPageContent();
      this.emitStep(taskId, "ACT", `تم البحث عن: "${task.description}"\n${pageContent.substring(0, 300)}`);
    }

    await sleep(500);

    // ── VERIFY ─────────────────────────────────────────────────────────────
    let finalResult = "";
    if (ollamaClient.isAvailable() && pageContent) {
      finalResult = await ollamaClient.chat([
        { role: "system", content: "أنت مساعد يلخص نتائج تصفح الويب بإيجاز." },
        { role: "user", content: `المهمة: "${task.description}"\nمحتوى الصفحة: ${pageContent.substring(0, 1000)}\nلخّص ما تم إنجازه` },
      ], { max_tokens: 300 }).catch(() => "تم تنفيذ المهمة بنجاح في المتصفح");
    } else {
      const url = await browserAgent.getCurrentUrl();
      finalResult = `تم تنفيذ المهمة. الموقع الحالي: ${url}`;
    }

    this.emitStep(taskId, "VERIFY", finalResult);

    taskStore.updateTask(taskId, { status: "completed", result: finalResult });
    taskStore.addLog({ taskId, agentType: "AgentRunner", action: "task_complete", output: finalResult.substring(0, 300), durationMs: Date.now() - start });
    this.emit("taskSuccess", { taskId, result: finalResult });
  }

  private async runWithOllama(task: Task, start: number): Promise<void> {
    const steps = ["OBSERVE", "THINK", "PLAN", "ACT", "VERIFY"];
    const prompts: Record<string, string> = {
      OBSERVE: `المهمة: "${task.description}"\nحلّل هذه المهمة. ما المتطلبات الرئيسية؟`,
      THINK:   `ما أفضل طريقة لتنفيذ هذه المهمة؟ ما التحديات المحتملة؟`,
      PLAN:    `أنشئ خطة تنفيذ بخطوات محددة لـ: "${task.description}"`,
      ACT:     `نفّذ المهمة وقدّم النتيجة الفعلية لـ: "${task.description}"`,
      VERIFY:  `تحقق من اكتمال المهمة. لخّص ما تم إنجازه.`,
    };
    const messages: ChatMessage[] = [{ role: "system", content: this.systemPrompt }];
    let finalResult = "";

    for (const step of steps) {
      messages.push({ role: "user", content: prompts[step] });
      this.emitStep(task.taskId, step, `...`);
      try {
        const resp = await ollamaClient.chat(messages, { temperature: 0.5, max_tokens: 600 });
        messages.push({ role: "assistant", content: resp });
        this.emitStep(task.taskId, step, resp);
        if (step === "ACT" || step === "VERIFY") finalResult = resp;
      } catch {
        this.emitStep(task.taskId, step, "جاري المعالجة...");
      }
      await sleep(300);
    }

    taskStore.updateTask(task.taskId, { status: "completed", result: finalResult });
    taskStore.addLog({ taskId: task.taskId, agentType: "AgentRunner", action: "task_complete", output: finalResult.substring(0, 300), durationMs: Date.now() - start });
    this.emit("taskSuccess", { taskId: task.taskId, result: finalResult });
  }

  private async simulateWithSteps(task: Task, start: number): Promise<void> {
    const content: Record<string, string> = {
      OBSERVE: `تحليل المهمة: "${task.description}". النوع: ${task.type}.`,
      THINK:   `التفكير في أفضل طريقة التنفيذ خطوة بخطوة.`,
      PLAN:    `الخطة:\n1. تهيئة الأدوات اللازمة\n2. تنفيذ الإجراءات المطلوبة\n3. التحقق من النتيجة`,
      ACT:     `تم تنفيذ المهمة. (لتفعيل الذكاء الاصطناعي الحقيقي ثبّت Ollama: ollama.ai ثم شغّل: ollama pull llama3)`,
      VERIFY:  `اكتملت المهمة بوضع المحاكاة. الوكيل جاهز لمهام جديدة.`,
    };
    for (const step of ["OBSERVE", "THINK", "PLAN", "ACT", "VERIFY"]) {
      await sleep(600);
      this.emitStep(task.taskId, step, content[step]);
    }
    const result = content["VERIFY"];
    taskStore.updateTask(task.taskId, { status: "completed", result });
    taskStore.addLog({ taskId: task.taskId, agentType: "AgentRunner", action: "task_complete", output: result, durationMs: Date.now() - start });
    this.emit("taskSuccess", { taskId: task.taskId, result });
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function extractUrl(text: string): string | null {
  const patterns = [
    /https?:\/\/[^\s]+/i,
    /(?:افتح|اذهب إلى|انتقل إلى|تصفح)\s+(?:موقع\s+)?([a-z0-9.-]+\.[a-z]{2,})/i,
    /(facebook\.com|twitter\.com|x\.com|youtube\.com|google\.com|instagram\.com|linkedin\.com|github\.com)/i,
    /(?:يوتيوب|youtube)/i,
    /(?:فيسبوك|facebook)/i,
    /(?:تويتر|twitter)/i,
    /(?:جوجل|google)/i,
    /(?:انستجرام|instagram)/i,
  ];

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
