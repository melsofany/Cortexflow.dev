import { EventEmitter } from "events";
import axios from "axios";
import { ollamaClient, ChatMessage } from "./ollamaClient.js";
import { taskStore, Task } from "./taskStore.js";
import { browserAgent } from "./browserAgent.js";
import { selectBestModel, formatModelSelection, modelSelector, classifyTask } from "./modelSelector.js";
import { plannerAgent, TaskPlan } from "./planner.js";
import { memorySystem } from "./memory.js";
import { multiAgentOrchestrator } from "./multiAgent.js";
import { learningEngine } from "./learningEngine.js";

const MAX_ITERATIONS = 20;
const MAX_RETRIES    = 2;
const AGENT_SERVICE  = process.env.AGENT_SERVICE_URL || "http://localhost:8090";

const DEEPSEEK_URL   = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";
const getDeepSeekKey = () => process.env.DEEPSEEK_API_KEY || "";

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
  const DEEPSEEK_KEY = getDeepSeekKey();
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
  if (getDeepSeekKey()) {
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
  select    - اختيار من قائمة منسدلة: PARAM: اسم_القائمة=الخيار
  ask       - اطلب من المستخدم إدخال بيانات: PARAM: وصف ما تحتاجه
  key       - ضغط مفتاح: PARAM: Enter أو Tab أو Escape
  scroll    - التمرير: PARAM: up أو down
  wait      - انتظار تحميل الصفحة: PARAM: waiting
  done      - المهمة مكتملة (بعد التحقق الفعلي): PARAM: وصف الإنجاز

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
المبدأ الأساسي: اقرأ الصفحة — لا تتخمن
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
في كل خطوة تحصل على "هيكل الصفحة الحالية". هذا الهيكل يُظهر:
  - [حقل] اسم الحقل من الصفحة مباشرةً → استخدمه في fill
  - [قائمة#N] رقم القائمة وخياراتها → استخدم nth:N في select
  - [زر] نص الزر الظاهر → استخدمه في click

القاعدة الذهبية:
  1. انظر إلى هيكل الصفحة المُعطى لك
  2. حدّد اسم الحقل/القائمة/الزر من الهيكل
  3. استخدم ذلك الاسم تماماً بدون تخمين أو اختراع

━━━ قاعدة fill ━━━
- استخدم القيمة في name= أو id= من هيكل الصفحة
- مثال: إذا ظهر [حقل] fill PARAM: email=... → استخدم: fill PARAM: email=القيمة

━━━ قاعدة select ━━━
- القوائم تُظهر رقمها: [قائمة#0]، [قائمة#1]، [قائمة#2]...
- استخدم الصيغة: select PARAM: nth:0=الخيار   (رقم القائمة من الهيكل)
- أو استخدم الاسم مباشرة إذا ظهر: select PARAM: day=15
- الخيارات المتاحة مذكورة في الهيكل — اختر أقرب قيمة مطابقة

━━━ قاعدة ask ━━━
- استخدم ask قبل fill للبيانات الحساسة: كلمة المرور، البريد، الهاتف
- مثال: ask PARAM: أدخل كلمة المرور

━━━ قاعدة done ━━━
- لا تستخدم done إلا بعد:
  * تغيّر URL إلى صفحة نجاح/تأكيد
  * أو ظهور رسالة نجاح صريحة في الصفحة
- إذا بقيت على نفس الصفحة → يوجد خطأ لم يُصحَّح بعد

━━━ قاعدة الصفحات بدون حقول إدخال ━━━
- إذا ظهر "لا توجد حقول إدخال" في الهيكل → الصفحة محملة لكنها صفحة تنقل
- الحل: استخدم click على زر/رابط "Log In" أو "تسجيل الدخول" أو ما يشابهه
- أو استخدم navigate للانتقال مباشرة إلى صفحة تسجيل الدخول
- لا تستخدم wait أكثر من مرة واحدة إذا لم تتغير الصفحة بعدها

القواعد الصارمة:
- سطر واحد فقط، لا شرح ولا تعليق
- للقوائم [قائمة] استخدم select وليس fill أو click
- كل أسماء الحقول والأزرار مصدرها هيكل الصفحة فقط
- لا تكرر نفس الإجراء 3 مرات متتالية بدون تغيير`;

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

    memorySystem.initSession(task.taskId, task.description);

    // Show conversation context if there's prior history
    const convHistory = task.conversationHistory || [];
    if (convHistory.length > 0) {
      const contextSummary = convHistory.slice(-4).map(m => `${m.role === "user" ? "المستخدم" : "المساعد"}: ${m.content.substring(0, 100)}`).join("\n");
      this.emitStep(task.taskId, "THINK", `📌 سياق المحادثة السابقة:\n${contextSummary}`);
    }

    // Check for failure hints from similar past tasks
    const failureHints = memorySystem.getFailureHints(task.description);
    if (failureHints) {
      this.emitStep(task.taskId, "THINK", failureHints);
    }

    // Propagate multi-agent activity events
    const onAgentActivity = (d: any) => {
      if (d.taskId === task.taskId) {
        this.emit("agentActivity", d);
      }
    };
    multiAgentOrchestrator.on("agentActivity", onAgentActivity);

    try {
      const { model, category, reason } = await selectBestModel(task.description, task.type);
      this.emitStep(task.taskId, "MODEL", formatModelSelection(model, category, reason));
      await sleep(200);

      if (task.type === "browser" || category === "browser") {
        await this.executeBrowserTask(task, start, model);
      } else if (this.shouldUsePythonAgent(category)) {
        await this.executePythonAgent(task, start, model, category);
      } else if (ollamaClient.isAvailable() || getDeepSeekKey()) {
        await this.runWithPlannerAndAgents(task, start, model, category);
      } else {
        await this.simulateWithSteps(task, start);
      }
    } catch (err: any) {
      const msg = err.message || "Unknown error";
      memorySystem.recordFailure(task.taskId, task.description, msg, "النهج الافتراضي");
      learningEngine.recordTaskOutcome(false);
      try { learningEngine.learnStrategy(task.description, [`فشل: ${msg.substring(0, 80)}`], false); } catch {}
      taskStore.updateTask(task.taskId, { status: "failed", error: msg });
      this.emit("taskFail", { taskId: task.taskId, error: msg });
    } finally {
      multiAgentOrchestrator.off("agentActivity", onAgentActivity);
      memorySystem.clearSession(task.taskId);
    }
  }

  // ── تنفيذ مع نظام التخطيط والوكلاء المتعددين ────────────────────────────
  private async runWithPlannerAndAgents(
    task: Task,
    start: number,
    model: string,
    category: string,
  ): Promise<void> {
    const taskId = task.taskId;

    // Build full task description with conversation context
    const convHistory = task.conversationHistory || [];
    let enrichedDescription = task.description;
    if (convHistory.length > 0) {
      const recentHistory = convHistory.slice(-6).map(m =>
        `${m.role === "user" ? "المستخدم" : "المساعد"}: ${m.content.substring(0, 200)}`
      ).join("\n");
      enrichedDescription = `سياق المحادثة:\n${recentHistory}\n\nالمهمة الحالية: ${task.description}`;
    }

    // 1) إنشاء الخطة
    this.emitStep(taskId, "PLANNING", "وكيل التخطيط يحلل المهمة...");
    const plan = await plannerAgent.createPlan(enrichedDescription, (msgs, opts) =>
      smartChat(msgs, opts || {}, "PLANNING"),
    );

    this.emit("taskPlan", { taskId, plan });
    this.emitStep(taskId, "PLAN", `خطة التنفيذ (${plan.steps.length} خطوات):\n${plan.steps.map((s) => `${s.id}. [${s.agent}] ${s.title}`).join("\n")}`);
    await sleep(300);

    // 2) تنفيذ كل خطوة بالوكيل المناسب
    const stepResults: Record<number, string> = {};

    for (const step of plan.steps) {
      this.emitStep(taskId, "ACT", `تنفيذ الخطوة ${step.id}/${plan.steps.length}: ${step.title}`);

      const result = await multiAgentOrchestrator.executeStep(
        taskId,
        step,
        task.description,
        stepResults,
        (msgs, opts, stepName) => smartChat(msgs, { ...opts, model }, stepName || ""),
      );

      stepResults[step.id] = result;
      this.emitStep(taskId, "VERIFY", `✓ الخطوة ${step.id}: ${step.title}\n${result.substring(0, 200)}`);
      await sleep(200);
    }

    // 3) مراجعة نهائية
    this.emitStep(taskId, "OBSERVE", "وكيل المراجعة يراجع النتائج النهائية...");
    const finalReview = await multiAgentOrchestrator.runReviewPhase(
      taskId,
      task.description,
      stepResults,
      (msgs, opts) => smartChat(msgs, { ...opts, model }),
    );

    const duration = Date.now() - start;
    modelSelector.recordResult(model, category, true, duration / 1000, 0.8);

    try {
      const taskData = taskStore.getTask(taskId);
      const actionSteps = (taskData?.steps || []).slice(0, 8).map((s: any) => `${s.step}: ${s.content.substring(0, 60)}`);
      learningEngine.learnStrategy(task.description, actionSteps, true);
      learningEngine.recordTaskOutcome(true);
    } catch {}

    taskStore.updateTask(taskId, { status: "completed", result: finalReview });
    taskStore.addLog({ taskId, agentType: "MultiAgent", action: "task_complete", output: finalReview.substring(0, 300), durationMs: duration });
    this.emit("taskSuccess", { taskId, result: finalReview });
  }

  private shouldUsePythonAgent(category: string): boolean {
    return ["math"].includes(category);
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

  // توقف مؤقت وانتظار إدخال المستخدم (حتى دقيقتين)
  waitForUserInput(taskId: string, question: string): Promise<string> {
    this.emit("needInput", { taskId, question });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(""), 120000);
      this.once(`userInput:${taskId}`, (answer: string) => {
        clearTimeout(timer);
        resolve(answer);
      });
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

    // أرسل خطة تمثيلية فوراً لإيقاف spinner التخطيط في الواجهة
    const browserPlan = {
      goal: task.description,
      category: "browser",
      estimatedTime: "1–3 دقائق",
      createdAt: new Date(),
      steps: [
        { id: 1, title: "مراقبة الصفحة", description: "فحص بنية الصفحة المستهدفة", agent: "browser" as const, status: "running" as const },
        { id: 2, title: "تنفيذ الإجراءات", description: "تعبئة النماذج والتفاعل مع العناصر", agent: "browser" as const, status: "pending" as const },
        { id: 3, title: "التحقق من النتيجة", description: "التأكد من اكتمال المهمة", agent: "browser" as const, status: "pending" as const },
      ],
    };
    this.emit("taskPlan", { taskId, plan: browserPlan });

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

    const targetUrl = extractUrl(task.description) || learningEngine.getLearnedUrl(task.description) || task.url;
    const learningHint = learningEngine.buildContextHint(task.description);
    if (learningHint) {
      this.emitStep(taskId, "THINK", `🧠 من الذاكرة المتعلَّمة:\n${learningHint}`);
    }
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
        await sleep(1200);
      }

      // ── مرحلة التحليل الأولية: اقرأ الصفحة كاملاً قبل البدء ────────────
      const initStruct  = await browserAgent.getPageStructure();
      const initContent = await browserAgent.getPageContent();
      const initUrl     = await browserAgent.getCurrentUrl();
      // Add login hint when page has no inputs but task requires login
      const taskLower = task.description.toLowerCase();
      const isLoginTask = taskLower.includes("دخول") || taskLower.includes("تسجيل") || taskLower.includes("login") || taskLower.includes("sign in") || taskLower.includes("بيانات");
      const pageHasNoInputs = !initStruct.includes("[حقل]") && !initStruct.includes("[قائمة");
      if (pageHasNoInputs && isLoginTask) {
        this.emitStep(taskId, "WARN", `⚠️ الصفحة الحالية لا تحتوي على حقول إدخال. إذا كانت المهمة تتطلب تسجيل الدخول، يجب الانتقال إلى صفحة تسجيل الدخول أولاً.`);
      }
      this.emitStep(taskId, "THINK", `تحليل الصفحة:\n${initStruct}`);

      // Build conversation context for browser task
      const browserConvHistory = task.conversationHistory || [];
      const browserConvContext = browserConvHistory.length > 0
        ? `\nسياق المحادثة: ${browserConvHistory.slice(-2).map(m => `${m.role === "user" ? "مستخدم" : "مساعد"}: ${m.content.substring(0, 80)}`).join(" | ")}\n`
        : "";

      const history: ChatMessage[] = [
        { role: "system", content: ACTION_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `المهمة: ${task.description}${browserConvContext}`,
            pageHasNoInputs && isLoginTask
              ? `\n💡 تنبيه: الصفحة الحالية لا تحتوي على نموذج إدخال. ابدأ بالنقر على زر تسجيل الدخول أو انتقل مباشرة إلى صفحة تسجيل الدخول للموقع المستهدف: ${targetUrl || "الموقع المطلوب"}\n`
              : "",
            `═══ تحليل الصفحة الأولية ═══`,
            `الرابط: ${initUrl}`,
            ``,
            `هيكل الصفحة الكامل:`,
            initStruct,
            ``,
            `النص المرئي:`,
            initContent.substring(0, 600),
            ``,
            `═══════════════════════════`,
            `لقد رأيت الصفحة كاملاً. الآن ابدأ بأول خطوة منطقية بناءً على ما قرأته.`,
            `أخرج سطر ACTION واحد فقط.`,
          ].join("\n"),
        },
      ];
      let consecutiveFails = 0;
      let lastStuckUrl = "";
      let sameUrlCount = 0;
      let consecutiveWaits = 0;
      let lastAction = "";

      for (let i = 1; i <= MAX_ITERATIONS; i++) {
        // في الخطوة الأولى استخدم التحليل الأولي، وبعدها اقرأ الصفحة من جديد
        const url     = i === 1 ? initUrl     : await browserAgent.getCurrentUrl();
        const struct  = i === 1 ? initStruct  : await browserAgent.getPageStructure();
        const content = i === 1 ? initContent : await browserAgent.getPageContent();

        // ── كشف تعليق الوكيل في نفس الصفحة ────────────────────────────────
        if (url === lastStuckUrl && i > 1) {
          sameUrlCount++;
        } else {
          sameUrlCount = 0;
          lastStuckUrl = url;
        }

        if (sameUrlCount >= 4) {
          this.emitStep(taskId, "WARN", `⚠️ علق الوكيل في نفس الصفحة (${sameUrlCount} مرات). سيجرّب نهجاً مختلفاً...`);
          history.push({
            role: "user",
            content: [
              `⚠️ تحذير هام: لقد مررت بنفس الصفحة ${sameUrlCount} مرات متتالية بدون تقدم حقيقي.`,
              `الرابط الحالي: ${url}`,
              ``,
              `يجب أن تغير نهجك الآن — اختر واحداً مما يلي:`,
              `1. إذا كانت هناك حقول مخفية أو محملة ديناميكياً → جرّب: wait PARAM: waiting ثم أعد المحاولة`,
              `2. إذا كانت هناك عقبة واضحة → اطلب مساعدة: ask PARAM: وصف العقبة`,
              `3. إذا كانت المهمة مستحيلة في هذه الصفحة → أخبر المستخدم: done PARAM: وصف سبب التعذّر`,
              `4. إذا كنت تحتاج بيانات اعتماد → اطلبها: ask PARAM: أحتاج اسم المستخدم وكلمة المرور`,
              `لا تكرر نفس الإجراء مرة أخرى.`,
            ].join("\n"),
          });
          sameUrlCount = 0;
          await sleep(1000);
        }

        // في الخطوة الأولى الرسالة مُحضَّرة مسبقاً، من الثانية فصاعداً أضف تحديثات الصفحة
        if (i > 1) {
          const pageState = [
            `─── تحديث الصفحة (الخطوة ${i}) ───`,
            `الرابط الحالي: ${url}`,
            `هيكل الصفحة:`,
            struct,
            `النص المرئي: ${content.substring(0, 400)}`,
            `الخطوة ${i} من ${MAX_ITERATIONS}: أخرج سطر ACTION واحد فقط.`,
          ].join("\n");
          history.push({ role: "user", content: pageState });
        }

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

        // ── كشف الإجراءات المتكررة (wait/navigate لنفس الرابط) ──────────────
        if (action === "wait" || (action === lastAction && action !== "fill" && action !== "click")) {
          consecutiveWaits++;
        } else {
          consecutiveWaits = 0;
        }
        lastAction = action;

        if (consecutiveWaits >= 2) {
          const freshStruct = await browserAgent.getPageStructure();
          const hasNoInputs = freshStruct.includes("لا توجد حقول إدخال");
          this.emitStep(taskId, "WARN", `⚠️ تكرار نفس الإجراء "${action}" (${consecutiveWaits} مرات) — تغيير النهج...`);
          history.push({
            role: "user",
            content: [
              `⚠️ لقد استخدمت "${action}" ${consecutiveWaits} مرات متتالية بدون نتيجة.`,
              hasNoInputs
                ? `الصفحة ليس بها حقول إدخال. يجب أن تنقر على زر "Log In" أو "تسجيل الدخول" أو تنتقل مباشرة إلى صفحة تسجيل الدخول على الموقع المستهدف: navigate PARAM: ${targetUrl || url}`
                : `يجب اتخاذ إجراء مختلف تماماً بناءً على هيكل الصفحة الحالي:`,
              ``,
              freshStruct.substring(0, 600),
              ``,
              `اختر إجراءً مختلفاً الآن — لا تكرر "${action}".`,
            ].join("\n"),
          });
          consecutiveWaits = 0;
          await sleep(500);
        }

        if (action === "done") {
          await sleep(1500);
          const currentUrl = await browserAgent.getCurrentUrl();
          const pageErrors = await browserAgent.detectErrors();
          const pageContent = await browserAgent.getPageContent();
          const pageContentL = pageContent.toLowerCase();

          // مؤشرات النجاح
          const SUCCESS_KW = ["congratulations","welcome","مرحباً","مرحبا","تم التسجيل","تم الإنشاء","successfully","تحقق من بريدك","check your email","verify","inbox","home","feed","dashboard","newsfeed","تم إنشاء"];
          const FORM_KW    = ["create new account","إنشاء حساب","sign up","register","create account","انشئ حساباً","انشاء حساب"];

          const hasSuccess  = SUCCESS_KW.some(k => pageContentL.includes(k.toLowerCase()));
          const stillOnForm = FORM_KW.some(k => pageContentL.includes(k.toLowerCase()));
          const urlChanged  = currentUrl !== (targetUrl || "") && !currentUrl.includes("/reg") && !currentUrl.includes("signup") && !currentUrl.includes("register");

          if (pageErrors.length > 0) {
            const errText = pageErrors.join(" | ");
            this.emitStep(taskId, "ERR", `⚠️ لم تكتمل المهمة — أخطاء: ${errText}`);
            history.push({ role: "user", content: `تحذير: طلبت done لكن توجد أخطاء في الصفحة:\n"${errText}"\nURL الحالي: ${currentUrl}\nصحّح الأخطاء أولاً باستخدام ask أو fill.` });
            continue;
          } else if (stillOnForm && !hasSuccess && !urlChanged) {
            this.emitStep(taskId, "WARN", `⚠️ النموذج لا يزال ظاهراً — لم تكتمل المهمة بعد`);
            history.push({ role: "user", content: `تحذير: طلبت done لكن النموذج لا يزال ظاهراً والصفحة لم تتغير.\nURL الحالي: ${currentUrl}\nتأكد من:\n1. ملء جميع الحقول المطلوبة\n2. الضغط على زر الإرسال/التسجيل\n3. الانتظار للتحقق من التغيير` });
            continue;
          } else {
            finalResult = param || "اكتملت المهمة بنجاح";
            break;
          }
        }

        // ── إجراء ask: توقف وانتظار إدخال المستخدم ───────────────────────────
        if (action === "ask") {
          this.emitStep(taskId, "ASK", param);
          const userAnswer = await this.waitForUserInput(taskId, param);
          if (userAnswer.trim()) {
            history.push({ role: "user", content: `المستخدم أدخل: ${userAnswer}` });
            this.emitStep(taskId, "ACT", `✓ استُلمت البيانات من المستخدم`);
          } else {
            this.emitStep(taskId, "ACT", `⏱ انتهت مهلة الانتظار — تابع بدون بيانات`);
          }
          await sleep(300);
          continue;
        }

        try {
          const actionResult = await executeAction(action, param);
          // لقطة فورية بعد كل إجراء للمزامنة مع التفكير
          await browserAgent.captureNow();
          // إبلاغ النموذج بفشل fill/select لكي يحاول بطريقة مختلفة
          if (actionResult?.success === false && (action === "fill" || action === "select")) {
            const errMsg = actionResult.error || `لم يُعثر على الحقل "${param}"`;
            this.emitStep(taskId, "WARN", `⚠️ فشل ${action}: ${errMsg}`);
            history.push({
              role: "user",
              content: `تحذير: فشل إجراء "${action}" للحقل "${param}"\n${errMsg}\nحاول استخدام اسم مختلف للحقل أو استخدم type بعد click على الحقل.`,
            });
          }
        } catch (err: any) {
          this.emitStep(taskId, "ACT", `تحذير: ${err.message}`);
        }

        // ── كشف الأخطاء التلقائي بعد كل إجراء ─────────────────────────────
        await sleep(300);
        const pageErrors = await browserAgent.detectErrors();
        if (pageErrors.length > 0) {
          const errText = pageErrors.join(" | ");
          this.emitStep(taskId, "ERR", `⚠️ ${errText}`);
          history.push({ role: "user", content: `أخطاء ظاهرة في الصفحة: ${errText}\nحلّل هذا الخطأ وصحّحه أو اطلب من المستخدم بيانات صحيحة باستخدام ask.` });
        }

        await sleep(200);

        if (i === MAX_ITERATIONS) {
          finalResult = `اكتمل التنفيذ. الموقع الأخير: ${await browserAgent.getCurrentUrl()}`;
        }
      }

      if (!finalResult) {
        const stuckUrl = await browserAgent.getCurrentUrl();
        finalResult = `وصل الوكيل إلى الحد الأقصى من المحاولات. الموقع الأخير: ${stuckUrl}`;
        const failReason = `تعذّر إنهاء مهمة المتصفح خلال ${MAX_ITERATIONS} خطوة. الموقع الأخير: ${stuckUrl}`;
        memorySystem.recordFailure(taskId, task.description, failReason, "تكرار نفس الصفحة دون تقدم");
        learningEngine.recordTaskOutcome(false);
        try {
          const taskData = taskStore.getTask(taskId);
          const failSteps = (taskData?.steps || []).slice(0, 8).map((s: any) => `${s.step}: ${s.content.substring(0, 60)}`);
          learningEngine.learnStrategy(task.description, failSteps, false);
        } catch {}
        this.emitStep(taskId, "WARN", `⚠️ انتهت المحاولات (${MAX_ITERATIONS} خطوة). يوصى بتحديد المهمة بشكل أكثر دقة أو استخدام بيانات مختلفة.`);
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

    // ── التعلم من نجاح المهمة ────────────────────────────────────────────
    try {
      const finalUrl = await browserAgent.getCurrentUrl();
      learningEngine.learnFromSuccessfulNavigation(task.description, finalUrl);
      const taskData = taskStore.getTask(taskId);
      const actionSteps = (taskData?.steps || []).slice(0, 8).map((s: any) => `${s.step}: ${s.content.substring(0, 60)}`);
      learningEngine.learnStrategy(task.description, actionSteps, true);
      learningEngine.recordTaskOutcome(true);
      this.emitStep(taskId, "THINK", `🧠 تعلّمت من هذه المهمة وحفظت الاستراتيجية الناجحة`);
    } catch {}

    taskStore.updateTask(taskId, { status: "completed", result: verifyResult });
    taskStore.addLog({ taskId, agentType: "AgentRunner", action: "task_complete", output: verifyResult.substring(0, 300), durationMs: duration });
    this.emit("taskSuccess", { taskId, result: verifyResult });
  }

  // ── تنفيذ مباشر مع Ollama ───────────────────────────────────────────────

  private async runWithOllama(task: Task, start: number, model: string, category: string): Promise<void> {
    const systemPrompt = SYSTEM_PROMPTS[category] || SYSTEM_PROMPTS.default;
    const steps = ["OBSERVE", "THINK", "PLAN", "ACT", "VERIFY"];

    // Build context string from conversation history
    const convHistory = task.conversationHistory || [];
    const convContext = convHistory.length > 0
      ? `\n\nسياق المحادثة السابقة:\n${convHistory.slice(-4).map(m => `${m.role === "user" ? "المستخدم" : "المساعد"}: ${m.content.substring(0, 150)}`).join("\n")}\n`
      : "";

    const prompts: Record<string, string> = {
      OBSERVE: `${convContext}المهمة: "${task.description}"\nحلّل المتطلبات وحدد التحديات.`,
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

  // الصيغة الكاملة الصحيحة: ACTION: xxx | PARAM: yyy
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

  // صيغة بديلة يستخدمها النموذج أحياناً: "fill PARAM: field=val" أو "navigate PARAM: url"
  const m2 = text.match(/^\s*(navigate|click|fill|select|ask|type|key|scroll|wait|done)\s+PARAM:\s*(.+)/im);
  if (m2) {
    const action = m2[1].toLowerCase().trim();
    let param = m2[2].trim().split("\n")[0].trim();
    if (action === "navigate") {
      param = cleanUrl(param);
      if (!param || isBlank(param)) return null;
    }
    return { action, param };
  }

  // صيغة مباشرة جداً من النموذج: "fill firstname=Ahmed"
  const m3 = text.match(/^\s*(navigate|click|fill|select|ask|type|key|scroll|wait|done)\s+([^\n]+)/im);
  if (m3) {
    const action = m3[1].toLowerCase().trim();
    let param = m3[2].trim().split("\n")[0].trim();
    // تجاهل إذا كانت نفس كلمة الأمر (مثلاً "fill fill=...")
    if (param.toLowerCase().startsWith(action)) return null;
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

async function executeAction(
  action: string,
  param: string,
): Promise<{ success: boolean; error?: string } | undefined> {
  switch (action) {
    case "navigate":
      await browserAgent.navigate(param);
      await browserAgent.captureNow();
      return { success: true };
    case "click": {
      const clicked = await browserAgent.clickByText(param);
      if (!clicked) return { success: false, error: `لم يُعثر على عنصر بالنص: "${param}"` };
      return { success: true };
    }
    case "fill": {
      const eqIdx = param.indexOf("=");
      if (eqIdx === -1) return { success: false, error: `صيغة خاطئة — يجب أن تكون: اسم_الحقل=القيمة` };
      const field = param.substring(0, eqIdx).trim();
      const value = param.substring(eqIdx + 1).trim();
      const filled = await browserAgent.smartFill(field, value);
      if (!filled) {
        console.log(`[fill] لم يُعثر على الحقل: "${field}" = "${value}"`);
        return { success: false, error: `لم يُعثر على الحقل "${field}" في الصفحة. راجع هيكل الصفحة لمعرفة الأسماء الصحيحة.` };
      }
      return { success: true };
    }
    case "select": {
      const eqIdx2 = param.indexOf("=");
      if (eqIdx2 === -1) return { success: false, error: `صيغة خاطئة — يجب أن تكون: اسم_القائمة=الخيار` };
      // لا تحذف nth:N — فقط نظّف المسافات الزائدة
      const selField = param.substring(0, eqIdx2).trim();
      const selValue = param.substring(eqIdx2 + 1).trim();
      const selected = await browserAgent.smartSelect(selField, selValue);
      if (!selected) {
        console.log(`[select] لم يُعثر على القائمة: "${selField}" = "${selValue}"`);
        return { success: false, error: `لم يُعثر على القائمة "${selField}" أو الخيار "${selValue}".` };
      }
      return { success: true };
    }
    case "type":
      await browserAgent.type(param);
      return { success: true };
    case "key":
      await browserAgent.pressKey(param);
      return { success: true };
    case "scroll":
      await browserAgent.scroll(0, param === "up" ? -400 : 400);
      return { success: true };
    case "wait":
      await sleep(2000);
      return { success: true };
    default:
      return undefined;
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
    "ميتا للمطورين": "https://developers.facebook.com/", "meta developer": "https://developers.facebook.com/",
    "meta for developers": "https://developers.facebook.com/", "developers.facebook": "https://developers.facebook.com/",
    "ميتا مطورين": "https://developers.facebook.com/", "موقع ميتا الخاص بالمطورين": "https://developers.facebook.com/",
    "whatsapp cloud api": "https://developers.facebook.com/docs/whatsapp/cloud-api/",
    "whatsapp business": "https://business.whatsapp.com/", "واتساب بيزنس": "https://business.whatsapp.com/",
  };
  const lower = text.toLowerCase();
  // Sort by key length descending so longer/more specific keys match first
  const sortedEntries = Object.entries(siteMap).sort((a, b) => b[0].length - a[0].length);
  for (const [key, url] of sortedEntries) {
    if (lower.includes(key.toLowerCase())) return url;
  }
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) return urlMatch[0];
  const domainMatch = text.match(/(?:افتح|اذهب|تصفح|open|visit|go to)\s+([a-z0-9.-]+\.[a-z]{2,})/i);
  if (domainMatch) return `https://${domainMatch[1]}`;
  return null;
}

export const agentRunner = new AgentRunner();
