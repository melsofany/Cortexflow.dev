import { EventEmitter } from "events";
import axios from "axios";
import { ollamaClient, ChatMessage } from "./ollamaClient.js";
import { taskStore, Task } from "./taskStore.js";
import { browserAgent } from "./browserAgent.js";
import { selectBestModel, formatModelSelection, modelSelector, classifyTask } from "./modelSelector.js";

const MAX_ITERATIONS = 20;
const MAX_RETRIES    = 2;
const AGENT_SERVICE  = process.env.AGENT_SERVICE_URL || "http://localhost:8090";

const DEEPSEEK_KEY   = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_URL   = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

function isWeakResponse(text: string): boolean {
  if (!text || text.trim().length < 20) return true;
  if (text.trim().startsWith("[خطأ") || text.trim().startsWith("[Error")) return true;
  if (text.trim().split(/\s+/).length < 5) return true;
  return false;
}

async function deepseekChat(
  messages: ChatMessage[],
  maxTokens = 800,
  temperature = 0.35,
): Promise<string> {
  if (!DEEPSEEK_KEY) return "";
  try {
    // إضافة تعليمة عربية إذا لم تكن الرسالة الأولى نظام بالفعل
    const hasSystem = messages.length > 0 && messages[0].role === "system";
    const arabicInstruction: ChatMessage = {
      role: "system",
      content: "أنت CortexFlow، وكيل ذكاء اصطناعي متقدم. يجب أن يكون تفكيرك وردودك باللغة العربية دائماً.",
    };
    const finalMessages = hasSystem ? messages : [arabicInstruction, ...messages];

    const res = await axios.post(
      DEEPSEEK_URL,
      { model: DEEPSEEK_MODEL, messages: finalMessages, max_tokens: maxTokens, temperature },
      { headers: { Authorization: `Bearer ${DEEPSEEK_KEY}`, "Content-Type": "application/json" }, timeout: 60000 },
    );
    const content: string = res.data?.choices?.[0]?.message?.content || "";
    if (content) console.log(`[DeepSeek] استُخدم (${content.length} حرف)`);
    return content;
  } catch (e: any) {
    console.log(`[DeepSeek] فشل: ${e.message}`);
    return "";
  }
}

async function smartChat(
  messages: ChatMessage[],
  opts: { temperature?: number; max_tokens?: number; model?: string } = {},
  stepName = "",
): Promise<string> {
  // DeepSeek API أولاً — إذا كان المفتاح متاحاً
  if (DEEPSEEK_KEY) {
    const hint = stepName ? `\n[المرحلة الحالية: ${stepName}]` : "";
    const msgs = hint && messages.length
      ? [...messages.slice(0, -1), { ...messages[messages.length - 1], content: messages[messages.length - 1].content + hint }]
      : messages;
    const dsResp = await deepseekChat(msgs, opts.max_tokens || 1200, opts.temperature || 0.35);
    if (dsResp && !isWeakResponse(dsResp)) return dsResp;
  }

  // النموذج المحلي كبديل
  try {
    const resp = await ollamaClient.chat(messages, opts);
    if (!isWeakResponse(resp)) return resp;
    return resp || "جاري المعالجة...";
  } catch {
    return "جاري المعالجة...";
  }
}

// ── نظام Prompt المتخصص ────────────────────────────────────────────────────

const ACTION_SYSTEM_PROMPT = `أنت وكيل أتمتة متصفح. تتحكم في متصفح حقيقي.
استجب بسطر واحد فقط بهذا التنسيق الثابت:
ACTION: <الإجراء> | PARAM: <القيمة>

الإجراءات المتاحة:
  navigate  - الانتقال إلى رابط URL: PARAM: https://...
  click     - النقر على عنصر بالنص المرئي: PARAM: نص_الزر
  fill      - ملء حقل نصي: PARAM: اسم_الحقل=القيمة
  select    - اختيار من قائمة منسدلة <select>: PARAM: اسم_القائمة=الخيار
  type      - كتابة نص في العنصر المحدد: PARAM: النص
  key       - ضغط مفتاح: PARAM: Enter أو Tab أو Escape
  scroll    - التمرير: PARAM: up أو down
  wait      - انتظار: PARAM: waiting
  done      - المهمة مكتملة: PARAM: وصف الإنجاز

قاعدة fill:
- استخدم اسم الحقل من name= أو id= الظاهر في هيكل الصفحة
- مثال: "fill PARAM: firstname=أحمد" ← "fill PARAM: email=user@example.com"

قاعدة select (للقوائم المنسدلة كالشهر والسنة والجنس):
- استخدم اسم القائمة من name= وقيمة الخيار النصية الظاهرة
- مثال: "select PARAM: month=يناير" ← "select PARAM: year=1990" ← "select PARAM: day=15"

أمثلة كاملة لتسجيل في فيسبوك:
ACTION: navigate | PARAM: https://www.facebook.com
ACTION: click | PARAM: Create new account
ACTION: fill | PARAM: firstname=أحمد
ACTION: fill | PARAM: lastname=محمد
ACTION: fill | PARAM: reg_email__=ahmed@example.com
ACTION: fill | PARAM: reg_passwd__=MyPassword123
ACTION: select | PARAM: birthday_day=15
ACTION: select | PARAM: birthday_month=يناير
ACTION: select | PARAM: birthday_year=1990
ACTION: select | PARAM: sex=1
ACTION: click | PARAM: Create new account
ACTION: done | PARAM: تم إنشاء الحساب بنجاح

القواعد الصارمة:
- أخرج سطر ACTION واحد فقط، لا شيء آخر أبداً
- للقوائم [قائمة] استخدم select وليس fill أو click
- استخدم "done" فقط بعد اكتمال المهمة الكاملة فعلاً`;

const ARABIC_RULE = `\nقاعدة أساسية: جميع ردودك وتفكيرك يجب أن يكون باللغة العربية حصراً.`;

const SYSTEM_PROMPTS: Record<string, string> = {
  code: `أنت CortexFlow، وكيل برمجة محترف.
تكتب كوداً نظيفاً وموثّقاً. تحلّل المتطلبات قبل الكتابة. تقدّم شرحاً موجزاً مع الكود.${ARABIC_RULE}`,

  research: `أنت CortexFlow، وكيل بحث وتحليل متعمق.
تجمع المعلومات بدقة، تحلّل من زوايا متعددة، وتقدّم ملخصات منظمة وشاملة.${ARABIC_RULE}`,

  creative: `أنت CortexFlow، وكيل إبداعي متميز.
تنتج محتوى أصيلاً وجذاباً بأسلوب احترافي. تتكيّف مع أسلوب المستخدم ومتطلباته.${ARABIC_RULE}`,

  math: `أنت CortexFlow، وكيل رياضيات ومنطق.
تحلّل المسائل خطوة بخطوة، تتحقق من الحسابات، وتشرح المنطق بوضوح.${ARABIC_RULE}`,

  reasoning: `أنت CortexFlow، وكيل تفكير استراتيجي.
تحلّل المواقف من جميع الجوانب، تقيّم الخيارات، وتقدّم توصيات مدعومة بالمنطق.${ARABIC_RULE}`,

  default: `أنت CortexFlow، وكيل ذكاء اصطناعي احترافي متكامل.
تنفّذ المهام بكفاءة واحترافية عالية. تردّ دائماً باللغة العربية.${ARABIC_RULE}`,
};

// ── الوكيل الرئيسي ─────────────────────────────────────────────────────────

class AgentRunner extends EventEmitter {

  async executeTask(task: Task): Promise<void> {
    const start = Date.now();
    taskStore.updateTask(task.taskId, { status: "running" });
    this.emit("taskStart", { taskId: task.taskId, description: task.description });

    try {
      const { model, category, reason } = await selectBestModel(task.description, task.type);
      this.emitStep(task.taskId, "MODEL", formatModelSelection(model, category, reason));
      await sleep(200);

      if (task.type === "browser" || category === "browser") {
        await this.executeBrowserTask(task, start, model);
      } else if (this.shouldUsePythonAgent(category)) {
        await this.executePythonAgent(task, start, model, category);
      } else if (ollamaClient.isAvailable()) {
        await this.runWithOllama(task, start, model, category);
      } else {
        await this.simulateWithSteps(task, start);
      }
    } catch (err: any) {
      const msg = err.message || "Unknown error";
      taskStore.updateTask(task.taskId, { status: "failed", error: msg });
      this.emit("taskFail", { taskId: task.taskId, error: msg });
    }
  }

  private shouldUsePythonAgent(category: string): boolean {
    return ["code", "math", "agent", "reasoning"].includes(category);
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

  // ── خدمة Python للمهام المعقدة ─────────────────────────────────────────

  private async executePythonAgent(task: Task, start: number, model: string, category: string): Promise<void> {
    const taskId = task.taskId;
    this.emitStep(taskId, "OBSERVE", `توجيه المهمة إلى الوكيل المتخصص في: ${category}`);

    try {
      const providerMap: Record<string, string> = {
        code:      "OpenInterpreter",
        math:      "OODA",
        agent:     "AutoGPT",
        reasoning: "LangGraph",
      };
      const provider = providerMap[category] || "OODA";

      this.emitStep(taskId, "THINK", `استخدام ${provider} مع نموذج ${model}`);

      const response = await axios.post(`${AGENT_SERVICE}/run`, {
        task:      task.description,
        provider,
        model,
        task_type: category,
      }, { timeout: 120000 });

      const data = response.data;

      for (const step of (data.steps || [])) {
        const match = step.match(/^\[([A-Z_:-]+)\]\s*([\s\S]*)/);
        if (match) {
          this.emitStep(taskId, match[1], match[2].trim());
        } else {
          this.emitStep(taskId, "ACT", step);
        }
        await sleep(100);
      }

      const result = data.result || "اكتملت المهمة";
      const duration = Date.now() - start;

      modelSelector.recordResult(model, category, true, duration / 1000, 0.8);

      taskStore.updateTask(taskId, { status: "completed", result });
      taskStore.addLog({ taskId, agentType: "PythonAgent", action: "task_complete", output: result.substring(0, 300), durationMs: duration });
      this.emit("taskSuccess", { taskId, result });

    } catch (err: any) {
      this.emitStep(taskId, "WARN", `خدمة Python غير متاحة — التبديل إلى Ollama المباشر`);
      await this.runWithOllama(task, start, model, category);
    }
  }

  // ── تنفيذ مهام المتصفح ─────────────────────────────────────────────────

  private async executeBrowserTask(task: Task, start: number, model: string): Promise<void> {
    const taskId = task.taskId;

    this.emitStep(taskId, "OBSERVE", `تحليل مهمة التصفح: "${task.description}"`);
    await sleep(300);

    const ready = await browserAgent.initialize();
    if (!ready) {
      this.emitStep(taskId, "OBSERVE", "تعذّر تشغيل المتصفح — التبديل إلى وضع النص");
      await this.runWithOllama(task, start, model, "browser");
      return;
    }

    const useOllama = ollamaClient.isAvailable();

    if (useOllama) {
      const thought = await smartChat([
        { role: "system", content: SYSTEM_PROMPTS.default },
        { role: "user", content: `المهمة: "${task.description}"\nما الموقع المستهدف وما الخطوات الكاملة؟` },
      ], { temperature: 0.4, max_tokens: 250, model }, "THINK");
      this.emitStep(taskId, "THINK", thought || "سأنفذ المهمة خطوة بخطوة");
    } else {
      this.emitStep(taskId, "THINK", `خطة تنفيذ: "${task.description}"`);
    }
    await sleep(200);

    const targetUrl = extractUrl(task.description) || task.url;
    if (useOllama) {
      const plan = await smartChat([
        { role: "system", content: SYSTEM_PROMPTS.default },
        { role: "user", content: `المهمة: "${task.description}". اذكر خطوات التنفيذ بإيجاز.` },
      ], { temperature: 0.3, max_tokens: 200, model }, "PLAN");
      this.emitStep(taskId, "PLAN", plan || `الانتقال إلى الموقع وتنفيذ الإجراءات`);
    } else {
      this.emitStep(taskId, "PLAN", targetUrl
        ? `1. الانتقال إلى ${targetUrl}\n2. تنفيذ الإجراءات\n3. التحقق`
        : `1. البحث عن الموقع\n2. تنفيذ المهمة\n3. التحقق`);
    }
    await sleep(200);

    this.emitStep(taskId, "ACT", `بدء التنفيذ بنموذج ${model}...`);

    let finalResult = "";

    if (!useOllama) {
      if (targetUrl) {
        await browserAgent.navigate(targetUrl).catch(() => {});
        finalResult = `تم الانتقال إلى: ${await browserAgent.getCurrentUrl()}`;
        this.emitStep(taskId, "ACT", finalResult);
      }
    } else {
      if (targetUrl) {
        this.emitStep(taskId, "ACT", `خطوة 0: الانتقال إلى ${targetUrl}`);
        await browserAgent.navigate(targetUrl).catch(() => {});
        await browserAgent.captureNow();
        await sleep(800);
      }

      const history: ChatMessage[] = [{ role: "system", content: ACTION_SYSTEM_PROMPT }];
      let consecutiveFails = 0;

      for (let i = 1; i <= MAX_ITERATIONS; i++) {
        const url     = await browserAgent.getCurrentUrl();
        const struct  = await browserAgent.getPageStructure();
        const content = await browserAgent.getPageContent();

        const pageState = [
          `المهمة: ${task.description}`,
          `الرابط الحالي: ${url}`,
          `هيكل الصفحة: ${struct.substring(0, 600)}`,
          `النص المرئي: ${content.substring(0, 400)}`,
          `الخطوة ${i} من ${MAX_ITERATIONS}: أخرج سطر ACTION واحد فقط.`,
        ].join("\n");

        history.push({ role: "user", content: pageState });

        let raw = "";
        for (let retry = 0; retry < MAX_RETRIES; retry++) {
          try {
            raw = await smartChat(history, { temperature: 0.15, max_tokens: 80, model }, "ACT");
            break;
          } catch (err: any) {
            if (retry === MAX_RETRIES - 1) {
              this.emitStep(taskId, "ACT", `خطأ في النموذج: ${err.message}`);
            }
          }
        }

        history.push({ role: "assistant", content: raw });
        const parsed = parseAction(raw);

        if (!parsed) {
          consecutiveFails++;
          this.emitStep(taskId, "ACT", `(رد غير منظّم — محاولة تصحيح...)`);
          const fallbackUrl = extractUrlFromText(raw);
          if (fallbackUrl) {
            this.emitStep(taskId, "ACT", `خطوة ${i}: navigate → ${fallbackUrl}`);
            await browserAgent.navigate(fallbackUrl).catch(() => {});
            consecutiveFails = 0;
          } else if (consecutiveFails >= 3) {
            history.push({
              role: "user",
              content: `IMPORTANT: You must respond with EXACTLY this format:\nACTION: navigate | PARAM: https://...\nDo NOT explain. ONE line only.`,
            });
            consecutiveFails = 0;
          }
          await sleep(500);
          continue;
        }

        consecutiveFails = 0;
        const { action, param } = parsed;
        this.emitStep(taskId, "ACT", `خطوة ${i}: ${action} → ${param}`);

        if (action === "done") {
          finalResult = param || "اكتملت المهمة بنجاح";
          break;
        }

        try {
          await executeAction(action, param);
          // لقطة فورية بعد كل إجراء للمزامنة مع التفكير
          await browserAgent.captureNow();
        } catch (err: any) {
          this.emitStep(taskId, "ACT", `تحذير: ${err.message}`);
        }

        await sleep(500);

        if (i === MAX_ITERATIONS) {
          finalResult = `اكتمل التنفيذ. الموقع الأخير: ${await browserAgent.getCurrentUrl()}`;
        }
      }

      if (!finalResult) {
        finalResult = `اكتمل التنفيذ. الموقع: ${await browserAgent.getCurrentUrl()}`;
      }
    }

    let verifyResult = finalResult;
    if (useOllama) {
      const url = await browserAgent.getCurrentUrl();
      verifyResult = await smartChat([
        { role: "system", content: "لخّص نتيجة المهمة بجملة أو جملتين." },
        { role: "user", content: `المهمة: "${task.description}"\nالنتيجة: ${finalResult}\nURL الحالي: ${url}\nلخّص ما تم.` },
      ], { max_tokens: 150, model }, "VERIFY") || finalResult;
    }

    this.emitStep(taskId, "VERIFY", verifyResult);

    const duration = Date.now() - start;
    modelSelector.recordResult(model, "browser", true, duration / 1000, 0.7);

    taskStore.updateTask(taskId, { status: "completed", result: verifyResult });
    taskStore.addLog({ taskId, agentType: "AgentRunner", action: "task_complete", output: verifyResult.substring(0, 300), durationMs: duration });
    this.emit("taskSuccess", { taskId, result: verifyResult });
  }

  // ── تنفيذ مباشر مع Ollama ───────────────────────────────────────────────

  private async runWithOllama(task: Task, start: number, model: string, category: string): Promise<void> {
    const systemPrompt = SYSTEM_PROMPTS[category] || SYSTEM_PROMPTS.default;
    const steps = ["OBSERVE", "THINK", "PLAN", "ACT", "VERIFY"];

    const prompts: Record<string, string> = {
      OBSERVE: `المهمة: "${task.description}"\nحلّل المتطلبات وحدد التحديات.`,
      THINK:   `ما أفضل طريقة لتنفيذ المهمة بالكامل؟ فكّر بعمق.`,
      PLAN:    `ضع خطة تنفيذ مفصّلة ومرقمة لـ: "${task.description}"`,
      ACT:     `نفّذ المهمة الآن وقدّم النتيجة الكاملة والمفصّلة.`,
      VERIFY:  `راجع النتيجة وتحقق من اكتمالها. لخّص ما تم إنجازه.`,
    };

    const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];
    let finalResult = "";

    for (const step of steps) {
      messages.push({ role: "user", content: prompts[step] });
      const maxTokens = step === "ACT" ? 800 : step === "VERIFY" ? 300 : 400;
      const resp = await smartChat(messages, { temperature: 0.35, max_tokens: maxTokens, model }, step);
      messages.push({ role: "assistant", content: resp });
      this.emitStep(task.taskId, step, resp);
      if (step === "ACT" || step === "VERIFY") finalResult = resp;
      await sleep(200);
    }

    const duration = Date.now() - start;
    modelSelector.recordResult(model, category, true, duration / 1000, 0.6);

    taskStore.updateTask(task.taskId, { status: "completed", result: finalResult });
    taskStore.addLog({ taskId: task.taskId, agentType: "AgentRunner", action: "task_complete", output: finalResult.substring(0, 300), durationMs: duration });
    this.emit("taskSuccess", { taskId: task.taskId, result: finalResult });
  }

  // ── وضع المحاكاة (بدون نماذج) ─────────────────────────────────────────

  private async simulateWithSteps(task: Task, start: number): Promise<void> {
    const content: Record<string, string> = {
      OBSERVE: `تحليل المهمة: "${task.description}".`,
      THINK:   `تحديد أفضل نهج للتنفيذ.`,
      PLAN:    `الخطة:\n1. تهيئة الأدوات\n2. تنفيذ الإجراءات\n3. التحقق`,
      ACT:     `⚠️ لا توجد نماذج مثبتة بعد. يتم تنزيل النماذج في الخلفية...\nاستخدم قسم "النماذج" لتتبع التنزيل.`,
      VERIFY:  `سيتوفر التنفيذ الكامل فور اكتمال تنزيل النماذج.`,
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

// ── دوال مساعدة ────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function parseAction(text: string): { action: string; param: string } | null {
  if (!text) return null;
  const m = text.match(/ACTION:\s*(\w+)\s*\|\s*PARAM:\s*(.+)/i);
  if (m) {
    const action = m[1].toLowerCase().trim();
    let param = m[2].trim().split("\n")[0].trim();
    if (action === "navigate") {
      param = cleanUrl(param);
      if (!param || isBlank(param)) return null;
    }
    return { action, param };
  }
  if (/\b(task complete|task done|completed|done)\b/i.test(text)) {
    return { action: "done", param: text.substring(0, 100) };
  }
  return null;
}

function cleanUrl(raw: string): string {
  let url = raw.replace(/^(url:|param:)\s*/i, "").trim();
  url = url.split(/[\s"'<>]/)[0];
  if (!url) return "";
  if (!url.startsWith("http")) url = "https://" + url;
  return url;
}

function isBlank(url: string): boolean {
  return url === "about:blank" || url === "https://about:blank" || url === "https://";
}

function extractUrlFromText(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (m) return m[0];
  const domain = text.match(/\b([a-z0-9-]+\.(com|org|net|io|dev))\b/i);
  if (domain) return `https://${domain[0]}`;
  return null;
}

async function executeAction(action: string, param: string): Promise<void> {
  switch (action) {
    case "navigate":
      await browserAgent.navigate(param);
      await browserAgent.captureNow();
      break;
    case "click":
      await browserAgent.clickByText(param);
      break;
    case "fill": {
      const eqIdx = param.indexOf("=");
      if (eqIdx === -1) break;
      const field = param.substring(0, eqIdx).trim();
      const value = param.substring(eqIdx + 1).trim();
      // استخدام smartFill أولاً (يدعم التسميات العربية والإنجليزية)
      const filled = await browserAgent.smartFill(field, value);
      if (!filled) {
        console.log(`[fill] لم يُعثر على الحقل: "${field}" = "${value}"`);
      }
      break;
    }
    case "select": {
      const eqIdx2 = param.indexOf("=");
      if (eqIdx2 === -1) break;
      const selField = param.substring(0, eqIdx2).trim();
      const selValue = param.substring(eqIdx2 + 1).trim();
      const selected = await browserAgent.smartSelect(selField, selValue);
      if (!selected) {
        console.log(`[select] لم يُعثر على القائمة: "${selField}" = "${selValue}"`);
      }
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
  }
}

function extractUrl(text: string): string | null {
  const siteMap: Record<string, string> = {
    "يوتيوب": "https://www.youtube.com", "youtube": "https://www.youtube.com",
    "فيسبوك": "https://www.facebook.com", "facebook": "https://www.facebook.com",
    "تويتر": "https://www.twitter.com", "twitter": "https://www.twitter.com",
    "جوجل": "https://www.google.com", "google": "https://www.google.com",
    "انستجرام": "https://www.instagram.com", "instagram": "https://www.instagram.com",
    "جيتهاب": "https://www.github.com", "github": "https://www.github.com",
    "لينكدإن": "https://www.linkedin.com", "linkedin": "https://www.linkedin.com",
    "ريديت": "https://www.reddit.com", "reddit": "https://www.reddit.com",
    "تيك توك": "https://www.tiktok.com", "tiktok": "https://www.tiktok.com",
    "أمازون": "https://www.amazon.com", "amazon": "https://www.amazon.com",
    "واتساب": "https://web.whatsapp.com", "whatsapp": "https://web.whatsapp.com",
    "ويكيبيديا": "https://ar.wikipedia.org", "wikipedia": "https://en.wikipedia.org",
    "ستاك اوفرفلو": "https://stackoverflow.com", "stackoverflow": "https://stackoverflow.com",
  };
  const lower = text.toLowerCase();
  for (const [key, url] of Object.entries(siteMap)) {
    if (lower.includes(key.toLowerCase())) return url;
  }
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) return urlMatch[0];
  const domainMatch = text.match(/(?:افتح|اذهب|تصفح|open|visit|go to)\s+([a-z0-9.-]+\.[a-z]{2,})/i);
  if (domainMatch) return `https://${domainMatch[1]}`;
  return null;
}

export const agentRunner = new AgentRunner();
