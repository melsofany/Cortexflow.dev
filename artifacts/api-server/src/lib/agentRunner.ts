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
import { techIntelligence } from "./techIntelligence.js";
import { dagPlanner, DAGPlan } from "./dagPlanner.js";
import { parallelExecutor } from "./parallelExecutor.js";
import { reactEngine } from "./reactEngine.js";
import { contextManager } from "./contextManager.js";
import { toolOrchestrator } from "./toolOrchestrator.js";
import {
  analyzeTaskComplexity,
  buildKnowledgeAudit,
  buildRealityChecklist,
  buildPreResearchPrompt,
  buildDoneVerificationPrompt,
  buildPostActionVerifyPrompt,
  buildPlatformAwarePrompt,
  detectFabricatedUrl,
  findPlatformPlaybook,
  parseReasoningLine,
  ErrorPatternTracker,
  SubGoalTracker,
  REASONING_ACTION_SYSTEM_PROMPT,
} from "./preTaskResearcher.js";

const MAX_ITERATIONS = 50;
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

const ACTION_SYSTEM_PROMPT = `أنت وكيل أتمتة متصفح محترف. تتحكم في متصفح حقيقي وتُكمل المهام بالكامل.
استجب بسطر واحد فقط بهذا التنسيق الثابت:
ACTION: <الإجراء> | PARAM: <القيمة>

الإجراءات المتاحة:
  navigate  - الانتقال إلى رابط URL: PARAM: https://...
  click     - النقر على عنصر بالنص المرئي: PARAM: نص_الزر
             أو نقر بـ CSS selector مباشر: PARAM: sel:#id أو sel:.class أو sel:[attr="val"]
  fill      - ملء حقل نصي: PARAM: اسم_الحقل=القيمة
  select    - اختيار من قائمة منسدلة: PARAM: اسم_القائمة=الخيار
  ask       - اطلب من المستخدم إدخال بيانات: PARAM: وصف ما تحتاجه
  key       - ضغط مفتاح: PARAM: Enter أو Tab أو Escape
  scroll    - التمرير: PARAM: up أو down
  wait      - انتظار تحميل الصفحة: PARAM: waiting
  done      - المهمة مكتملة تماماً (بعد التحقق الفعلي من كل المعايير): PARAM: وصف الإنجاز

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 المبدأ الجوهري: أكمل المهمة حتى النهاية
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
أنت مُكلَّف بتنفيذ المهمة بالكامل — ليس مجرد الوصول للموقع.
- الوصول للموقع = البداية فقط، ليس الإنجاز
- يجب تنفيذ كل خطوة في الخطة المعطاة لك حتى تكتمل المهمة حقاً
- إذا المهمة تقول "أنشئ تطبيقاً" → يجب أن يُنشأ التطبيق فعلاً
- إذا المهمة تقول "احصل على API" → يجب أن تظهر بيانات الـ API
- لا تقل done حتى تتحقق من كل معيار في قائمة معايير الاكتمال

في كل خطوة تحصل على "هيكل الصفحة الحالية". هذا الهيكل يُظهر:
  - [حقل] اسم الحقل من الصفحة مباشرةً → استخدمه في fill
  - [قائمة#N] رقم القائمة وخياراتها → استخدم nth:N في select
  - [زر] نص الزر الظاهر → استخدمه في click

القاعدة الذهبية:
  1. انظر إلى هيكل الصفحة المُعطى لك
  2. حدّد الخطوة التالية من خطة DeepSeek
  3. نفّذ الخطوة بناءً على ما تراه في هيكل الصفحة

━━━ قاعدة fill ━━━
- استخدم القيمة في name= أو id= من هيكل الصفحة
- مثال: إذا ظهر [حقل] fill PARAM: email=... → استخدم: fill PARAM: email=القيمة

━━━ قاعدة select ━━━
- القوائم تُظهر رقمها: [قائمة#0]، [قائمة#1]، [قائمة#2]...
- استخدم الصيغة: select PARAM: nth:0=الخيار   (رقم القائمة من الهيكل)
- أو استخدم الاسم مباشرة إذا ظهر: select PARAM: day=15
- الخيارات المتاحة مذكورة في الهيكل — اختر أقرب قيمة مطابقة

━━━ قاعدة click وأزرار أي موقع ━━━
- النقر على الأزرار: استخدم النص المرئي كما يظهر في هيكل الصفحة
- إذا ظهر [sel:...] بجانب الزر في هيكل الصفحة → استخدمه مباشرة: click PARAM: sel:#loginBtn
- إذا فشل click بالنص → استخدم: click PARAM: sel:SELECTOR من هيكل الصفحة
- إذا فشل كل شيء → استخدم: key PARAM: Enter
- الوكيل ذكي: إذا فشل النقر بالنص، يستشير DeepSeek تلقائياً ليختار العنصر الصحيح

━━━ قاعدة ask ━━━
- استخدم ask للبيانات الحساسة التي لا يمكنك معرفتها: كلمة المرور، البريد، الهاتف
- بعد حصولك على البيانات تابع التنفيذ فوراً

━━━ قاعدة done — مهم جداً ━━━
- done يعني أن الدليل الملموس مرئي الآن على الشاشة — ليس مجرد إتمام الخطوات
- لا تستخدم done لأنك وصلت للصفحة الرئيسية للموقع
- لا تستخدم done لأنك تسجّلت دخول فقط — الدخول وسيلة وليس هدفاً
- قبل done: اقرأ هيكل الصفحة الحالي وتأكد أن الدليل المطلوب مرئي فيه فعلاً
- إذا شككت → اسأل نفسك: "هل أرى الدليل الملموس على الشاشة الآن؟" إذا لا → تابع

━━━ قواعد مكافحة الهلوسة — مهم جداً ━━━
- لا تنتقل إلى رابط يحتوي على IDs أو أرقام لم تظهر في هيكل الصفحة الحالية
- إذا فشل نفس الإجراء 3 مرات → استخدم ask لإبلاغ المستخدم بدلاً من المحاولة مجدداً
- لا تخترع بيانات (App IDs، أرقام مرجعية، access tokens) — اقرأها من الصفحة فقط
- إذا رأيت خطأ تكرر → لا تحاول تجاوزه بنفس الطريقة، بل اطلب توضيحاً من المستخدم
- كل معلومة تستخدمها يجب أن تأتي من: هيكل الصفحة الحالي، أو إدخال المستخدم
- الاستنتاج المبني على ما تراه أفضل بكثير من الافتراض المبني على الذاكرة

━━━ قاعدة الصفحات بدون حقول إدخال ━━━
- إذا ظهر "لا توجد حقول إدخال" → الصفحة صفحة تنقل أو محتوى
- الحل: انقر على الزر/الرابط المناسب أو انتقل للصفحة الصحيحة
- لا تستخدم wait أكثر من مرة واحدة إذا لم تتغير الصفحة

القواعد الصارمة:
- سطر واحد فقط، لا شرح ولا تعليق
- للقوائم [قائمة] استخدم select وليس fill أو click
- كل أسماء الحقول والأزرار مصدرها هيكل الصفحة فقط
- لا تكرر نفس الإجراء 3 مرات متتالية بدون تغيير`;

const ARABIC_RULE = `\nقاعدة أساسية: جميع ردودك وتفكيرك يجب أن يكون باللغة العربية حصراً. استخدم Markdown لتنسيق ردودك (عناوين، قوائم، كود، جداول).`;

function buildSystemPrompts(): Record<string, string> {
  const tech = techIntelligence.getTechContextForAgent();
  const techNote = tech ? `\n\n🔬 معرفة تقنية محدّثة:${tech}` : "";
  return {
    code: `أنت CortexFlow، وكيل برمجة متقدم على مستوى Senior Engineer.

قدراتك:
- كتابة كود نظيف، موثّق، وقابل للصيانة
- تحليل المتطلبات وتحديد أفضل البنية المعمارية
- شرح الكود بوضوح مع أمثلة عملية
- اكتشاف الأخطاء وتقديم حلول محسّنة

أسلوب الرد:
- قدّم الكود في code blocks مناسبة
- اشرح المنطق خطوة بخطوة
- أضف تعليقات داخل الكود عند الحاجة
- اذكر أي تبعيات أو متطلبات للتثبيت${techNote}${ARABIC_RULE}`,

    research: `أنت CortexFlow، وكيل بحث وتحليل متعمق على مستوى خبير.

قدراتك:
- تجميع المعلومات من مصادر متعددة وتحليلها
- تقديم ملخصات منظمة وشاملة
- المقارنة والتحليل النقدي
- استخلاص النتائج والتوصيات

أسلوب الرد:
- استخدم عناوين وعناوين فرعية لتنظيم المعلومات
- قدّم النقاط الرئيسية في قوائم منظمة
- أضف جداول للمقارنات عند الحاجة
- اختم بملخص وتوصيات واضحة${techNote}${ARABIC_RULE}`,

    creative: `أنت CortexFlow، وكيل إبداعي ومحتوى احترافي.

قدراتك:
- إنتاج محتوى أصيل وجذاب بأساليب متنوعة
- كتابة قصص، مقالات، سيناريوهات، وأكواد إبداعية
- التكيّف مع أسلوب المستخدم ومتطلباته
- تقديم أفكار مبتكرة وغير تقليدية

أسلوب الرد:
- كن إبداعياً في الأسلوب والتنسيق
- استخدم لغة غنية ومعبّرة
- قدّم خيارات وبدائل عند الطلب${ARABIC_RULE}`,

    math: `أنت CortexFlow، وكيل رياضيات ومنطق دقيق.

قدراتك:
- حل المسائل الرياضية بجميع مستوياتها
- شرح المفاهيم الرياضية بطريقة مبسطة
- التحقق من الحسابات خطوة بخطوة
- تطبيق المنطق والاستدلال الرياضي

أسلوب الرد:
- اعرض الحل خطوة بخطوة مع شرح كل خطوة
- استخدم التنسيق الرياضي الصحيح
- تحقق من النتيجة النهائية
- قدّم طرقاً بديلة للحل عند الإمكان${ARABIC_RULE}`,

    reasoning: `أنت CortexFlow، وكيل تفكير استراتيجي وتحليل عميق.

قدراتك:
- تحليل المشكلات من جميع الجوانب
- تقييم الخيارات وعواقبها
- التفكير النقدي وتحديد نقاط الضعف والقوة
- تقديم توصيات مدعومة بالمنطق والأدلة

أسلوب الرد:
- ابدأ بفهم المشكلة وتحليل السياق
- قدّم إطاراً تحليلياً واضحاً
- ناقش المزايا والعيوب لكل خيار
- اختم بتوصية واضحة ومبررة${techNote}${ARABIC_RULE}`,

    default: `أنت CortexFlow، وكيل ذكاء اصطناعي متقدم يعمل على مستوى Claude/ChatGPT/DeepSeek.

قدراتك الشاملة:
- الإجابة على الأسئلة بعمق ودقة
- تنفيذ المهام المعقدة خطوة بخطوة
- التحليل والبحث والكتابة والبرمجة
- فهم السياق والتكيّف مع احتياجات المستخدم

معايير الجودة:
- قدّم إجابات شاملة ومفصّلة
- نظّم المعلومات بشكل واضح باستخدام Markdown
- كن دقيقاً وأميناً في المعلومات
- أضف أمثلة عملية عند الحاجة
- اقترح خطوات تالية أو موارد مفيدة${techNote}${ARABIC_RULE}`,
  };
}
const SYSTEM_PROMPTS: Record<string, string> = buildSystemPrompts();

// ── الوكيل الرئيسي ─────────────────────────────────────────────────────────

class AgentRunner extends EventEmitter {

  async executeTask(task: Task): Promise<void> {
    const start = Date.now();
    taskStore.updateTask(task.taskId, { status: "running" });
    this.emit("taskStart", { taskId: task.taskId, description: task.description });

    // تسجيل بداية المهمة في نظام المراقبة
    techIntelligence.onTaskStart(task.taskId);

    // تحديث السياق التقني في كل مهمة
    Object.assign(SYSTEM_PROMPTS, buildSystemPrompts());

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
      techIntelligence.onTaskEnd(task.taskId, false);
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

    // بناء وصف المهمة مع سياق المحادثة
    const convHistory = task.conversationHistory || [];
    let enrichedDescription = task.description;
    if (convHistory.length > 0) {
      const recentHistory = convHistory.slice(-6).map(m =>
        `${m.role === "user" ? "المستخدم" : "المساعد"}: ${m.content.substring(0, 200)}`
      ).join("\n");
      enrichedDescription = `سياق المحادثة:\n${recentHistory}\n\nالمهمة الحالية: ${task.description}`;
    }

    const smartChatFn = (msgs: ChatMessage[], opts?: Record<string, unknown>, stepName?: string) =>
      smartChat(msgs, { ...(opts || {}), model }, stepName || "");

    // تحديد إذا كانت المهمة تستفيد من ReAct Loop
    const isSimpleChat = /^(ما|من|كيف|متى|أين|هل|شرح|اشرح|عرّف|ما هو|ما هي|اقترح|قائمة|اعطني|أعطني)/i.test(task.description.trim());

    if (isSimpleChat && task.description.length < 200) {
      // مسار سريع: استجابة مباشرة بدون تخطيط
      await this.runDirectResponse(task, start, model, category, enrichedDescription);
      return;
    }

    // ══════════════════════════════════════════════════════════════════════
    // المسار المتقدم: DAG + Parallel + ReAct
    // ══════════════════════════════════════════════════════════════════════

    // 1) إنشاء خطة DAG
    this.emitStep(taskId, "PLANNING", "🧠 وكيل التخطيط يحلل المهمة ويبني مخطط تنفيذ ذكي...");

    const dagPlan = await dagPlanner.createDAGPlan(enrichedDescription, smartChatFn);

    // إرسال الخطة للواجهة الأمامية
    this.emit("taskPlan", {
      taskId,
      plan: {
        steps: Array.from(dagPlan.nodes.values()).map(n => ({
          id: n.id,
          title: n.title,
          description: n.description,
          agent: n.agent,
          status: n.status,
          dependencies: n.dependencies,
          isParallel: n.isParallel,
        })),
        category: dagPlan.category,
        estimatedTime: `${dagPlan.totalNodes * 20} ثانية`,
        createdAt: dagPlan.createdAt,
        goal: dagPlan.goal,
      },
    });

    const nodeList = Array.from(dagPlan.nodes.values())
      .map(n => `${n.isParallel ? "⟋" : "→"} [${n.agent}] ${n.title}${n.dependencies.length > 0 ? ` (بعد: ${n.dependencies.join(", ")})` : ""}`)
      .join("\n");

    this.emitStep(taskId, "PLAN",
      `📊 خطة التنفيذ (${dagPlan.totalNodes} مهمة | نمط DAG):\n${nodeList}\n\n` +
      `🔀 المهام المتوازية: ${Array.from(dagPlan.nodes.values()).filter(n => n.dependencies.length === 0 && dagPlan.executionOrder[0]?.length > 1).length}`
    );

    await sleep(300);

    // 2) تنفيذ بالتوازي مع DAG
    this.emitStep(taskId, "ACT", "⚡ بدء التنفيذ المتوازي الذكي...");

    // ربط أحداث المُنفّذ المتوازي
    const onBatchStart = (d: { batchId: string; nodeIds: string[] }) => {
      if (d.nodeIds.length > 1) {
        this.emitStep(taskId, "ACT", `⚡ تنفيذ متوازٍ: ${d.nodeIds.join(" + ")}`);
      }
    };
    const onNodeComplete = (d: { taskId: string; nodeId: string; status: string }) => {
      if (d.taskId === taskId) {
        const node = dagPlan.nodes.get(d.nodeId);
        if (node) {
          const icon = node.status === "done" ? "✅" : "❌";
          this.emitStep(taskId, "VERIFY", `${icon} ${node.title}: ${(node.result || node.error || "").substring(0, 150)}`);
        }
      }
    };

    parallelExecutor.on("batchStart", onBatchStart);
    parallelExecutor.on("nodeComplete", onNodeComplete);

    let allResults: Record<string, string> = {};

    try {
      allResults = await parallelExecutor.executePlan(
        taskId,
        dagPlan,
        smartChatFn,
        (nodeId, status, result) => {
          const node = dagPlan.nodes.get(nodeId);
          if (node && status === "running") {
            this.emitStep(taskId, "ACT", `🔄 [${node.agent}] ${node.title}...`);
          }
        },
      );
    } finally {
      parallelExecutor.off("batchStart", onBatchStart);
      parallelExecutor.off("nodeComplete", onNodeComplete);
    }

    // 3) مرحلة التحقق والمراجعة النهائية
    this.emitStep(taskId, "OBSERVE", "🔍 وكيل المراجعة يدمج النتائج ويتحقق من الجودة...");

    const successfulResults = Object.entries(allResults)
      .filter(([, v]) => v && v.length > 10)
      .map(([k, v]) => `[${k}]: ${v.substring(0, 350)}`)
      .join('\n\n');

    let finalReview = "";

    if (successfulResults.length > 0) {
      finalReview = await smartChatFn(
        [
          {
            role: "system",
            content: `أنت وكيل مراجعة ودمج. مهمتك تجميع نتائج المهام المتوازية في إجابة نهائية متماسكة وشاملة.
قواعد:
- ادمج النتائج بشكل منطقي ومنظم
- أزل التكرار وادمج المعلومات المتشابهة
- قدّم النتيجة بلغة عربية واضحة مع Markdown
- تأكد من الإجابة على الهدف الأصلي بالكامل`,
          },
          {
            role: "user",
            content: `الهدف: ${task.description}\n\nنتائج المهام:\n${successfulResults}\n\nقدّم إجابة نهائية شاملة.`,
          },
        ],
        { temperature: 0.3, max_tokens: 1200 },
        "REVIEW_MERGE",
      );
    } else {
      finalReview = await smartChatFn(
        [{ role: "user", content: task.description }],
        { temperature: 0.4, max_tokens: 900 },
        "DIRECT_ANSWER",
      );
    }

    const duration = Date.now() - start;
    const completedCount = Array.from(dagPlan.nodes.values()).filter(n => n.status === "done").length;
    const successRate = dagPlan.totalNodes > 0 ? (completedCount / dagPlan.totalNodes) : 1;

    modelSelector.recordResult(model, category, successRate > 0.5, duration / 1000, successRate);

    try {
      const taskData = taskStore.getTask(taskId);
      const actionSteps = (taskData?.steps || []).slice(0, 8).map((s: Record<string, string>) => `${s.step}: ${s.content?.substring(0, 60)}`);
      learningEngine.learnStrategy(task.description, actionSteps, successRate > 0.5);
      learningEngine.recordTaskOutcome(successRate > 0.5);
    } catch {}

    techIntelligence.onTaskEnd(taskId, successRate > 0.5);
    taskStore.updateTask(taskId, { status: "completed", result: finalReview });
    taskStore.addLog({
      taskId,
      agentType: "DAG+Parallel",
      action: "task_complete",
      output: finalReview.substring(0, 300),
      durationMs: duration,
    });
    this.emit("taskSuccess", { taskId, result: finalReview });
  }

  private async runDirectResponse(
    task: Task,
    start: number,
    model: string,
    category: string,
    enrichedDescription: string,
  ): Promise<void> {
    const taskId = task.taskId;
    this.emitStep(taskId, "THINK", "💬 استجابة مباشرة...");

    const systemPrompt = SYSTEM_PROMPTS[category] || SYSTEM_PROMPTS.default;
    const result = await smartChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: enrichedDescription },
      ],
      { temperature: 0.4, max_tokens: 1200, model },
      "DIRECT",
    );

    const duration = Date.now() - start;
    modelSelector.recordResult(model, category, true, duration / 1000, 0.9);
    techIntelligence.onTaskEnd(taskId, true);
    taskStore.updateTask(taskId, { status: "completed", result });
    taskStore.addLog({ taskId, agentType: "DirectResponse", action: "task_complete", output: result.substring(0, 300), durationMs: duration });
    this.emit("taskSuccess", { taskId, result });
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
    // تسجيل الخطوات الهامة في console لتظهر في سجلات Render
    const logSteps = ["ACT", "WARN", "ERR", "THINK", "VERIFY", "ASK"];
    if (logSteps.includes(step)) {
      console.log(`[${step}] ${content.substring(0, 200)}`);
    }
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
      // 10 minutes — gives plenty of time for reconnection
      const timer = setTimeout(() => {
        this.removeAllListeners(`userInput:${taskId}`);
        resolve("");
      }, 600000);
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

      techIntelligence.onTaskEnd(taskId, true);
      taskStore.updateTask(taskId, { status: "completed", result });
      taskStore.addLog({ taskId, agentType: "PythonAgent", action: "task_complete", output: result.substring(0, 300), durationMs: duration });
      this.emit("taskSuccess", { taskId, result });

    } catch (err: any) {
      this.emitStep(taskId, "WARN", `خدمة Python غير متاحة — التبديل إلى Ollama المباشر`);
      await this.runWithOllama(task, start, model, category);
    }
  }

  // ── التحليل العميق للمهمة قبل التنفيذ (مثل DeepSeek في الشات) ─────────
  private async deepAnalyzeTask(taskDescription: string, targetUrl: string | null): Promise<{ analysis: string; steps: string[]; needsFromUser: string[]; targetUrl: string | null; completionCriteria: string[] }> {
    const DEEP_ANALYSIS_PROMPT = `أنت CortexFlow، وكيل ذكاء اصطناعي متقدم. مهمتك تحليل المهمة التالية بعمق كامل قبل التنفيذ.

قم بما يلي:
1. **فهم المهمة**: ما الهدف النهائي الدقيق؟
2. **تحديد الموقع**: ما الرابط الصحيح للبدء؟
3. **تحليل المتطلبات**: ما الذي يحتاجه المستخدم لإكمال هذه المهمة (حسابات، بيانات اعتماد، معلومات)؟
4. **خطة التنفيذ**: اذكر الخطوات بدقة وتسلسل منطقي — كن دقيقاً وشاملاً
5. **ما يجب طلبه من المستخدم**: إذا كانت المهمة تحتاج بيانات حساسة (كلمة مرور، رقم هاتف، الخ)
6. **معايير الاكتمال**: ما الذي يثبت أن المهمة اكتملت فعلاً؟ (ليس مجرد الوصول للموقع)

تنسيق الإجابة (JSON فقط):
{
  "understanding": "شرح فهمك الكامل للمهمة",
  "targetUrl": "الرابط الصحيح للبدء",
  "steps": ["الخطوة 1", "الخطوة 2", ...],
  "needsFromUser": ["ما يجب طلبه من المستخدم قبل البدء"],
  "warnings": ["تحذيرات مهمة"],
  "completionCriteria": ["ما الدليل الملموس على اكتمال المهمة — مثل: ظهور App ID، أو رسالة نجاح، أو الوصول لصفحة بعينها"]
}`;

    try {
      const resp = await deepseekChat([
        { role: "system", content: DEEP_ANALYSIS_PROMPT },
        { role: "user", content: `المهمة: "${taskDescription}"\nالرابط المقترح: ${targetUrl || "غير محدد، حدده أنت"}` },
      ], 1800, 0.3);

      const jsonMatch = resp.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // نظّف الرابط الذي حدده DeepSeek
        let dsUrl: string | null = null;
        if (parsed.targetUrl && typeof parsed.targetUrl === "string") {
          const rawUrl = parsed.targetUrl.trim();
          if (rawUrl.startsWith("http")) dsUrl = rawUrl;
          else if (rawUrl.length > 3) dsUrl = "https://" + rawUrl;
        }
        const criteria: string[] = parsed.completionCriteria || [];
        return {
          analysis: [
            `## 🧠 فهم المهمة\n${parsed.understanding || ""}`,
            dsUrl ? `\n## 🌐 الرابط الهدف\n${dsUrl}` : "",
            `\n## 📋 خطوات التنفيذ\n${(parsed.steps || []).map((s: string, i: number) => `${i+1}. ${s}`).join("\n")}`,
            criteria.length ? `\n## ✅ معايير الاكتمال\n${criteria.map((s: string) => `- ${s}`).join("\n")}` : "",
            parsed.needsFromUser?.length ? `\n## ❓ مطلوب من المستخدم\n${(parsed.needsFromUser as string[]).map((s: string) => `- ${s}`).join("\n")}` : "",
            parsed.warnings?.length ? `\n## ⚠️ تحذيرات\n${(parsed.warnings as string[]).map((s: string) => `- ${s}`).join("\n")}` : "",
          ].filter(Boolean).join(""),
          steps: parsed.steps || [],
          needsFromUser: parsed.needsFromUser || [],
          targetUrl: dsUrl,
          completionCriteria: criteria,
        };
      }
    } catch {}

    return { analysis: `تحليل المهمة: "${taskDescription}"`, steps: [], needsFromUser: [], targetUrl: null, completionCriteria: [] };
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
        { id: 1, title: "تحليل عميق للمهمة", description: "DeepSeek يفهم المتطلبات الكاملة", agent: "browser" as const, status: "running" as const },
        { id: 2, title: "تنفيذ الإجراءات", description: "تعبئة النماذج والتفاعل مع العناصر", agent: "browser" as const, status: "pending" as const },
        { id: 3, title: "التحقق من النتيجة", description: "التأكد من اكتمال المهمة", agent: "browser" as const, status: "pending" as const },
      ],
    };
    this.emit("taskPlan", { taskId, plan: browserPlan });

    this.emitStep(taskId, "OBSERVE", `تحليل مهمة التصفح: "${task.description}"`);
    await sleep(300);

    // ══════════════════════════════════════════════════════════════════════
    // ── مرحلة ما قبل التنفيذ: تحليل التعقيد والبحث المسبق ──────────────
    // ══════════════════════════════════════════════════════════════════════
    const complexity   = analyzeTaskComplexity(task.description);
    const audit        = buildKnowledgeAudit(task.description, complexity);
    const realityList  = buildRealityChecklist(task.description);
    const errorTracker = new ErrorPatternTracker();

    // عرض تقرير التعقيد للمستخدم
    this.emitStep(taskId, "THINK", [
      `## 🔬 تحليل تعقيد المهمة`,
      `درجة التعقيد: **${complexity.score}/10** (${complexity.category})`,
      complexity.reasons.length ? `أسباب: ${complexity.reasons.join(" | ")}` : "",
      ``,
      audit.prerequisites.length ? `## ✅ متطلبات يجب توافرها قبل البدء\n${audit.prerequisites.map(p => `- ${p}`).join("\n")}` : "",
      audit.knownFailurePoints.length ? `## ⚠️ نقاط فشل معروفة لهذا النوع\n${audit.knownFailurePoints.map(f => `- ${f}`).join("\n")}` : "",
      ``,
      `## 🎯 دليل الاكتمال (ما يجب أن أراه على الشاشة)\n${realityList.items.map(i => `- **${i.criterion}**: ${i.mustBeVisible}`).join("\n")}`,
    ].filter(Boolean).join("\n"));
    await sleep(200);

    // للمهام المعقدة جداً: تقرير بحث مسبق من DeepSeek
    if (complexity.isComplex && getDeepSeekKey()) {
      this.emitStep(taskId, "THINK", `🧪 البحث المسبق — DeepSeek يحلل متطلبات المنصة...`);
      try {
        const prePrompt = buildPreResearchPrompt(task.description, complexity, audit, realityList);
        const preResp = await deepseekChat([
          { role: "system", content: "أنت خبير في أتمتة المواقع الإلكترونية وتعرف متطلبات المنصات الكبرى." },
          { role: "user", content: prePrompt },
        ], 1500, 0.2);

        const preJson = preResp.match(/\{[\s\S]*\}/);
        if (preJson) {
          const pre = JSON.parse(preJson[0]);
          const parts: string[] = ["## 📋 تقرير البحث المسبق (قبل البدء)"];
          if (pre.warningToUser) parts.push(`\n⚠️ **تحذير مهم:** ${pre.warningToUser}`);
          if (pre.preChecks?.length) parts.push(`\n### ما يجب التحقق منه قبل البدء\n${pre.preChecks.map((c: string) => `- ${c}`).join("\n")}`);
          if (pre.cannotBeAutomated?.length) parts.push(`\n### ❌ لا يمكن أتمتته (يحتاج تدخل يدوي)\n${pre.cannotBeAutomated.map((c: string) => `- ${c}`).join("\n")}`);
          if (pre.realSteps?.length) parts.push(`\n### خطوات التنفيذ الواقعية\n${pre.realSteps.map((s: string, i: number) => `${i+1}. ${s}`).join("\n")}`);
          if (pre.completionProof?.length) parts.push(`\n### الدليل الملموس على الاكتمال\n${pre.completionProof.map((c: string) => `- ${c}`).join("\n")}`);
          this.emitStep(taskId, "THINK", parts.join("\n"));
        }
      } catch (e: any) {
        console.log(`[PreResearch] فشل: ${e.message}`);
      }
    }
    // ══════════════════════════════════════════════════════════════════════

    const ready = await browserAgent.initialize();
    if (!ready) {
      this.emitStep(taskId, "OBSERVE", "تعذّر تشغيل المتصفح — التبديل إلى وضع النص");
      await this.runWithOllama(task, start, model, "browser");
      return;
    }

    // حلقة التنفيذ تعمل إذا توفر DeepSeek أو Ollama (ليس فقط Ollama)
    const useOllama = ollamaClient.isAvailable() || !!getDeepSeekKey();

    // ── التحليل العميق بـ DeepSeek (مثل تحليل الشات) ──────────────────
    const extractedUrl = extractUrl(task.description) || learningEngine.getLearnedUrl(task.description) || task.url;
    this.emitStep(taskId, "THINK", `🔍 DeepSeek يحلل المهمة بعمق...`);
    const { analysis: deepAnalysis, steps: plannedSteps, needsFromUser, targetUrl: deepSeekUrl, completionCriteria } = await this.deepAnalyzeTask(task.description, extractedUrl);
    this.emitStep(taskId, "THINK", deepAnalysis);

    // ▶ رابط DeepSeek يحظى بأولوية قصوى — فهو يفهم السياق أفضل من المطابقة النصية
    const targetUrl = deepSeekUrl || extractedUrl;
    if (deepSeekUrl && deepSeekUrl !== extractedUrl) {
      this.emitStep(taskId, "THINK", `🎯 DeepSeek حدد الرابط الصحيح: ${deepSeekUrl} (تم تجاوز: ${extractedUrl || "لا يوجد"})`);
    }

    // إذا كانت المهمة تحتاج بيانات من المستخدم — أخبره فوراً
    if (needsFromUser.length > 0) {
      this.emitStep(taskId, "WARN", `⚠️ **قبل البدء يجب توفير:**\n${needsFromUser.map(n => `- ${n}`).join("\n")}\n\nيرجى تزويد هذه المعلومات في المحادثة حتى يتمكن الوكيل من إكمال المهمة.`);
    }
    await sleep(200);
    const learningHint = learningEngine.buildContextHint(task.description);
    if (learningHint) {
      this.emitStep(taskId, "THINK", `🧠 من الذاكرة المتعلَّمة:\n${learningHint}`);
    }
    // عرض خطة التنفيذ من التحليل العميق
    if (plannedSteps.length > 0) {
      this.emitStep(taskId, "PLAN", `خطة التنفيذ (DeepSeek):\n${plannedSteps.map((s, i) => `${i+1}. ${s}`).join("\n")}`);
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
        try {
          await browserAgent.navigate(targetUrl);
        } catch (navErr: any) {
          this.emitStep(taskId, "WARN", `⚠️ تعذّر التنقل إلى ${targetUrl}: ${navErr?.message || navErr}\nسيحاول الوكيل مجدداً أو يبحث عن بديل.`);
        }
        await browserAgent.captureNow();
        await sleep(1200);
      }

      // ── مرحلة التحليل الأولية: اقرأ الصفحة كاملاً قبل البدء ────────────
      // ── الطبقة الأولى: Accessibility Tree (يمنع الهلوسة 27%→3%) ──────────
      const initStruct  = await browserAgent.getAccessibilityTree();
      const initContent = await browserAgent.getPageContent();
      const initUrl     = await browserAgent.getCurrentUrl();
      // Add login hint when page has no inputs but task requires login
      const taskLower = task.description.toLowerCase();
      const isLoginTask = taskLower.includes("دخول") || taskLower.includes("تسجيل") || taskLower.includes("login") || taskLower.includes("sign in") || taskLower.includes("بيانات");
      const pageHasNoInputs = !initStruct.includes("[e") && !initStruct.includes("textbox") && !initStruct.includes("combobox");
      if (pageHasNoInputs && isLoginTask) {
        this.emitStep(taskId, "WARN", `⚠️ الصفحة الحالية لا تحتوي على حقول إدخال. إذا كانت المهمة تتطلب تسجيل الدخول، يجب الانتقال إلى صفحة تسجيل الدخول أولاً.`);
      }
      this.emitStep(taskId, "THINK", `تحليل الصفحة:\n${initStruct}`);

      // ── كشف صفحات الأمان قبل بدء الحلقة ────────────────────────────────
      {
        const cpHandled = await handleSecurityCheckpoint(
          initContent,
          initStruct,
          (type, msg) => this.emitStep(taskId, type, msg),
          (q) => this.waitForUserInput(taskId, q),
        );
        if (cpHandled) {
          this.emitStep(taskId, "ACT", `✅ تمت معالجة نقطة التفتيش الأولية: ${cpHandled}`);
          await browserAgent.captureNow();
        }
      }

      // Build conversation context for browser task
      const browserConvHistory = task.conversationHistory || [];
      const browserConvContext = browserConvHistory.length > 0
        ? `\nسياق المحادثة: ${browserConvHistory.slice(-2).map(m => `${m.role === "user" ? "مستخدم" : "مساعد"}: ${m.content.substring(0, 80)}`).join(" | ")}\n`
        : "";

      // ── قاعدة الرابط الصحيح: محقونة كأول رسالة حتى لا ينحرف الوكيل ──
      const urlConstraint = targetUrl
        ? [
            `🔒 قاعدة ثابتة: الرابط الصحيح لهذه المهمة هو: ${targetUrl}`,
            `لا تنتقل إلى أي رابط آخر ما لم تكن قد أكملت خطوة مهمة بالفعل.`,
            `إذا رأيت "واتساب" أو "whatsapp" في المهمة — الرابط الصحيح هو ${targetUrl} وليس web.whatsapp.com أو business.whatsapp.com.`,
          ].join("\n")
        : "";

      // خطة DeepSeek العميقة تُضاف كسياق دائم في حلقة التنفيذ
      const deepPlanContext = [
        plannedSteps.length > 0 ? [
          ``,
          `═══ الخطة المفصلة (حللها DeepSeek) ═══`,
          plannedSteps.map((s, i) => `${i+1}. ${s}`).join("\n"),
          `═══════════════════════════════════════`,
          `اتبع هذه الخطة خطوة بخطوة. لا تتجاوز خطوة إلا بعد إتمامها.`,
        ].join("\n") : "",
        completionCriteria.length > 0 ? [
          ``,
          `🎯 المهمة تُعتبر مكتملة فقط عندما:`,
          completionCriteria.map(c => `  ✓ ${c}`).join("\n"),
          `لا تستخدم done قبل التحقق من هذه المعايير واحداً واحداً.`,
        ].join("\n") : "",
      ].filter(Boolean).join("\n");

      // ── تهيئة SubGoalTracker ───────────────────────────────────────────────
      const subGoalTracker = new SubGoalTracker();
      if (plannedSteps.length > 0) {
        subGoalTracker.initialize(plannedSteps);
        this.emitStep(taskId, "PLAN", `🗺️ تتبع الأهداف الفرعية:\n${subGoalTracker.getProgressReport()}`);
      }

      // ── Platform Playbook ────────────────────────────────────────────────
      const playbook = findPlatformPlaybook(task.description);
      const playbookContext = playbook ? buildPlatformAwarePrompt(playbook) : "";
      if (playbook) {
        this.emitStep(taskId, "THINK", `📚 قاعدة معرفة المنصة مُفعَّلة: ${playbook.platform}`);
      }

      const history: ChatMessage[] = [
        { role: "system", content: REASONING_ACTION_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            urlConstraint,
            `المهمة: ${task.description}${browserConvContext}`,
            deepPlanContext,
            playbookContext ? `\n${playbookContext}\n` : "",
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
            subGoalTracker.getCurrentGoal() ? `\n${subGoalTracker.getCurrentGoalContext()}\n` : "",
            `لقد رأيت الصفحة كاملاً. الآن ابدأ بأول خطوة منطقية بناءً على ما قرأته واتبع الخطة المحددة.`,
            `أخرج سطرين: THINK ثم ACTION.`,
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
        // Accessibility Tree (الطبقة الأولى — بدلاً من HTML الخام)
        const struct  = i === 1 ? initStruct  : await browserAgent.getAccessibilityTree();
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
          const currentStruct = await browserAgent.getAccessibilityTree();
          const hasForm = currentStruct.includes("textbox") || currentStruct.includes("combobox") || currentStruct.includes("[e");
          history.push({
            role: "user",
            content: [
              `⚠️ تحذير هام: لقد مررت بنفس الصفحة ${sameUrlCount} مرات متتالية بدون تقدم حقيقي.`,
              `الرابط الحالي: ${url}`,
              ``,
              `يجب أن تغير نهجك الآن — اختر واحداً مما يلي:`,
              hasForm
                ? `1. إذا ملأت الحقول بالفعل → اضغط Enter لإرسال النموذج: key PARAM: Enter`
                : `1. إذا كانت الصفحة تحتاج وقتاً للتحميل → جرّب: wait PARAM: waiting`,
              `2. إذا كان النقر على الزر لا يعمل → جرّب ضغط Enter مباشرة: key PARAM: Enter`,
              `3. إذا كان الزر باللغة الإنجليزية → جرّب: click PARAM: Log In أو click PARAM: Login أو click PARAM: Continue`,
              `4. إذا كنت تحتاج بيانات اعتماد → اطلبها: ask PARAM: أحتاج البريد الإلكتروني وكلمة المرور`,
              `5. إذا كان هناك تحقق إضافي مطلوب (CAPTCHA، تأكيد هاتف) → ask PARAM: وصف ما تراه`,
              `هيكل الصفحة الحالي للمساعدة:\n${currentStruct.substring(0, 500)}`,
              `لا تكرر نفس الإجراء الذي فشل مرة أخرى.`,
            ].join("\n"),
          });
          sameUrlCount = 0;
          await sleep(1000);
        }

        // في الخطوة الأولى الرسالة مُحضَّرة مسبقاً، من الثانية فصاعداً أضف تحديثات الصفحة
        if (i > 1) {
          // كل 10 خطوات: أعد تذكير الوكيل بالهدف الكامل ومعايير الاكتمال
          const periodicReminder = (i % 10 === 0 && (plannedSteps.length > 0 || completionCriteria.length > 0))
            ? [
                ``,
                `═══ تذكير بالهدف (الخطوة ${i}) ═══`,
                plannedSteps.length > 0 ? `الخطة الكاملة:\n${plannedSteps.map((s, idx) => `${idx+1}. ${s}`).join("\n")}` : ``,
                completionCriteria.length > 0 ? `المهمة مكتملة فقط عندما:\n${completionCriteria.map(c => `  ✓ ${c}`).join("\n")}` : ``,
                subGoalTracker.getCurrentGoal() ? `\n${subGoalTracker.getProgressReport()}\n${subGoalTracker.getCurrentGoalContext()}` : ``,
                `الرابط الحالي: ${url}`,
                `هل وصلت لكل هذه المعايير؟ إذا لا → تابع. إذا نعم → done`,
                `═══════════════════════════════════`,
              ].filter(Boolean).join("\n")
            : "";
          // إضافة سياق SubGoalTracker كل 5 خطوات
          if (i % 5 === 0 && subGoalTracker.getCurrentGoal()) {
            this.emitStep(taskId, "PLAN", subGoalTracker.getProgressReport());
          }

          const pageState = [
            `─── تحديث الصفحة (الخطوة ${i}) ───`,
            `الرابط الحالي: ${url}`,
            `هيكل الصفحة:`,
            struct,
            `النص المرئي: ${content.substring(0, 400)}`,
            periodicReminder,
            subGoalTracker.getCurrentGoal() ? subGoalTracker.getCurrentGoalContext() : "",
            `الخطوة ${i} من ${MAX_ITERATIONS}: أخرج سطرين فقط: THINK ثم ACTION.`,
          ].filter(Boolean).join("\n");
          history.push({ role: "user", content: pageState });
        }

        let raw = "";
        for (let retry = 0; retry < MAX_RETRIES; retry++) {
          try {
            raw = await smartChat(history, { temperature: 0.15, max_tokens: 160, model }, "ACT");
            break;
          } catch (err: any) {
            if (retry === MAX_RETRIES - 1) {
              this.emitStep(taskId, "ACT", `خطأ في النموذج: ${err.message}`);
            }
          }
        }

        history.push({ role: "assistant", content: raw });

        // ── استخراج الاستدلال الإلزامي (THINK) وعرضه ──────────────────────
        const reasoning = parseReasoningLine(raw);
        if (reasoning?.think) {
          this.emitStep(taskId, "THINK", `🧠 [${i}] ${reasoning.think}`);
        }

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
              content: `IMPORTANT: You must respond with EXACTLY this format:\nTHINK: [what you see] | [expected result] | [why this action]\nACTION: navigate | PARAM: https://...\nTwo lines. Nothing else.`,
            });
            consecutiveFails = 0;
          }
          await sleep(500);
          continue;
        }

        consecutiveFails = 0;
        const { action, param } = parsed;
        subGoalTracker.incrementAttempt();
        this.emitStep(taskId, "ACT", `خطوة ${i}: ${action} → ${param}`);

        // ── كشف الإجراءات المتكررة (wait/navigate لنفس الرابط) ──────────────
        if (action === "wait" || (action === lastAction && action !== "fill" && action !== "click")) {
          consecutiveWaits++;
        } else {
          consecutiveWaits = 0;
        }
        lastAction = action;

        if (consecutiveWaits >= 2) {
          const freshStruct = await browserAgent.getAccessibilityTree();
          const hasNoInputs = !freshStruct.includes("[e") && !freshStruct.includes("textbox");
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
          const currentUrl    = await browserAgent.getCurrentUrl();
          const pageErrors    = await browserAgent.detectErrors();
          const pageContent   = await browserAgent.getPageContent();

          // أولاً: تحقق من الأخطاء الظاهرة
          if (pageErrors.length > 0) {
            const errText = pageErrors.join(" | ");
            this.emitStep(taskId, "ERR", `⚠️ لم تكتمل المهمة — أخطاء: ${errText}`);
            history.push({ role: "user", content: `تحذير: طلبت done لكن توجد أخطاء في الصفحة:\n"${errText}"\nURL الحالي: ${currentUrl}\nصحّح الأخطاء أولاً.` });
            continue;
          }

          // ثانياً: تحقق حقيقي مُعزَّز — القائمة الواقعية + DeepSeek
          this.emitStep(taskId, "THINK", `🔍 التحقق المُعزَّز من اكتمال المهمة بناءً على الدليل المرئي...`);
          try {
            // استخدم بناء التحقق المُعزَّز مع القائمة الواقعية
            const enhancedVerifyPrompt = buildDoneVerificationPrompt(
              task.description,
              realityList,
              currentUrl,
              pageContent,
            );

            const verifyResp = await deepseekChat([
              { role: "system", content: `أنت محكّم صارم للتحقق من المهام. لا تقبل الاكتمال إلا بدليل مرئي واضح في النص المُعطى.` },
              { role: "user", content: enhancedVerifyPrompt },
            ], 800, 0.1);

            const vJson = verifyResp.match(/\{[\s\S]*\}/);
            if (vJson) {
              const v = JSON.parse(vJson[0]);
              if (v.completed === true) {
                subGoalTracker.markCurrentDone(v.evidence || param);
                this.emitStep(taskId, "THINK", `✅ تم التحقق بالدليل المرئي: ${v.evidence}`);
                if (subGoalTracker.getCurrentGoal()) {
                  this.emitStep(taskId, "PLAN", subGoalTracker.getProgressReport());
                }
                finalResult = param || v.evidence || "اكتملت المهمة بنجاح";
                break;
              } else {
                const missing = v.missingItems?.length ? `\nما لم يتحقق بعد:\n${(v.missingItems as string[]).map((m: string) => `  - ${m}`).join("\n")}` : "";
                this.emitStep(taskId, "WARN", `⚠️ المهمة لم تكتمل — الدليل غير مرئي على الشاشة: ${v.evidence}${missing}`);
                history.push({
                  role: "user",
                  content: [
                    `⛔ رُفض done: المهمة لم تكتمل بناءً على ما يُرى على الشاشة الآن.`,
                    `الدليل المطلوب غير موجود: ${v.evidence}`,
                    v.missingItems?.length ? `العناصر المفقودة:\n${(v.missingItems as string[]).map((m: string) => `- ${m}`).join("\n")}` : ``,
                    v.nextAction ? `الخطوة التالية: ${v.nextAction}` : ``,
                    ``,
                    `تذكير: done يعني أن الدليل الملموس مرئي الآن على الشاشة، ليس مجرد إتمام الخطوات.`,
                    `تابع العمل حتى يظهر الدليل على الشاشة.`,
                  ].filter(Boolean).join("\n"),
                });
                continue;
              }
            }
          } catch { }

          // احتياطي: قبل done إذا فشل DeepSeek
          finalResult = param || "اكتملت المهمة";
          break;
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

        // ── منع الانحراف عن الرابط المستهدف في إجراء navigate ─────────────
        let effectiveAction = action;
        let effectiveParam  = param;
        if (action === "navigate" && targetUrl) {
          try {
            const destHost   = new URL(param.startsWith("http") ? param : "https://" + param).hostname.replace(/^www\./, "");
            const targetHost = new URL(targetUrl).hostname.replace(/^www\./, "");
            if (destHost !== targetHost && !targetHost.includes(destHost) && !destHost.includes(targetHost)) {
              this.emitStep(taskId, "WARN", `🚫 تم منع الانتقال إلى ${param} — الرابط المقفل هو: ${targetUrl}`);
              history.push({
                role: "user",
                content: `تحذير: لقد حاولت الانتقال إلى ${param} لكن هذه المهمة مقفلة على ${targetUrl}.\nلا تنتقل إلى أي موقع آخر. تابع العمل على ${targetUrl} فقط.`,
              });
              effectiveAction = "navigate";
              effectiveParam  = targetUrl;
            }
          } catch { }
        }

        // ── كشف الروابط المخترعة من الذاكرة (لم تُرَ على الشاشة) ────────
        if (action === "navigate") {
          const currentPageContent = await browserAgent.getPageContent();
          const currentPageStruct  = await browserAgent.getAccessibilityTree();
          if (detectFabricatedUrl(effectiveParam, currentPageContent, currentPageStruct)) {
            this.emitStep(taskId, "WARN", [
              `🚨 **كشف رابط مخترع**: الرابط "${effectiveParam}" يحتوي على معرّفات (IDs) غير مرئية في الصفحة الحالية.`,
              `هذا يعني أن الوكيل يبني الرابط من ذاكرته وليس مما يراه على الشاشة.`,
              `القاعدة: لا تنتقل إلى رابط لم تره مكتوباً في الصفحة أو لم تُنشئه الصفحة بنفسها.`,
            ].join("\n"));
            history.push({
              role: "user",
              content: [
                `⛔ محاولة الانتقال إلى "${effectiveParam}" مرفوضة.`,
                `هذا الرابط يحتوي على معرّفات لم تظهر في الصفحة الحالية — قد يكون مخترعاً من الذاكرة.`,
                `القاعدة الصارمة: انتقل فقط إلى روابط مرئية على الصفحة الحالية أو روابط جاءت من النقر على أزرار/روابط حقيقية.`,
                `بدلاً من ذلك: ابحث عن الزر أو الرابط الصحيح في هيكل الصفحة وانقر عليه.`,
              ].join("\n"),
            });
            continue;
          }
        }

        // ── الطبقة الثالثة: التقاط حالة الصفحة قبل الإجراء (Mano 2025) ──────
        const isStateCheckAction = effectiveAction === "navigate" || effectiveAction === "click" || effectiveAction === "key";
        const beforeFingerprint  = isStateCheckAction ? await browserAgent.getStateFingerprint() : "";

        try {
          const actionResult = await executeAction(effectiveAction, effectiveParam);
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

        // ── كشف صفحات الأمان بعد كل navigate/click ──────────────────────────
        if (action === "navigate" || action === "click" || action === "key") {
          await sleep(800);

          // ── تحقق الطبقة الثالثة: هل تغيّرت الحالة بعد الإجراء؟ ──────────
          if (isStateCheckAction && beforeFingerprint) {
            const afterFingerprint = await browserAgent.getStateFingerprint();
            const stateChange = await browserAgent.stateHasChanged(beforeFingerprint, afterFingerprint);
            if (!stateChange.changed && action !== "key") {
              // لم يحدث أي تغيير — الإجراء فشل فعلياً
              this.emitStep(taskId, "WARN", `⚠️ [تحقق الحالة] "${action} → ${param.slice(0,50)}" لم يُحدث أي تغيير في الصفحة`);
              const currentA11y = await browserAgent.getAccessibilityTree();
              history.push({
                role: "user",
                content: [
                  `⛔ **إجراء بدون أثر**: "${action} → ${param.slice(0,80)}" نُفِّذ لكن الصفحة لم تتغير.`,
                  `هذا يعني أن العنصر لم يكن موجوداً فعلاً أو أن النقر لم ينجح.`,
                  ``,
                  `العناصر المتاحة الآن في الصفحة:`,
                  currentA11y.split("\n").slice(0, 20).join("\n"),
                  ``,
                  `اختر إجراءً بديلاً بناءً على العناصر المرئية أعلاه. لا تكرر نفس الإجراء.`,
                ].join("\n"),
              });
            } else if (stateChange.changed) {
              this.emitStep(taskId, "THINK", `✓ [تحقق الحالة] الإجراء نجح: ${stateChange.detail}`);
            }
          }
          const cpContent = await browserAgent.getPageContent();
          const cpStruct  = await browserAgent.getAccessibilityTree();
          const cpHandled = await handleSecurityCheckpoint(
            cpContent,
            cpStruct,
            (type, msg) => this.emitStep(taskId, type, msg),
            (q) => this.waitForUserInput(taskId, q),
          );
          if (cpHandled) {
            this.emitStep(taskId, "ACT", `✅ تمت معالجة نقطة التفتيش: ${cpHandled}`);
            history.push({ role: "user", content: `تمت معالجة صفحة أمان تلقائياً: ${cpHandled}\nتابع من الخطوة التالية في الخطة.` });
            await browserAgent.captureNow();
          }
        }

        // ── كشف الأخطاء التلقائي بعد كل إجراء ─────────────────────────────
        await sleep(300);
        const pageErrors = await browserAgent.detectErrors();
        if (pageErrors.length > 0) {
          const errText = pageErrors.join(" | ");
          const errorPattern = errorTracker.record(errText);
          this.emitStep(taskId, "ERR", `⚠️ ${errText}`);

          // إذا تكرر الخطأ أكثر من الحد المسموح → وقف وتصعيد للمستخدم
          if (errorTracker.isRepeating(errText)) {
            const escalationMsg = errorTracker.getEscalationMessage(errText);
            this.emitStep(taskId, "WARN", escalationMsg);
            this.emitStep(taskId, "ASK", `⛔ خطأ متكرر يمنع المتابعة:\n"${errText.substring(0, 150)}"\n\nالتصنيف: ${errorPattern.category}\nيرجى مراجعة الموقع مباشرة أو تزويد بيانات إضافية للمتابعة.`);
            const userAnswer = await this.waitForUserInput(taskId, `خطأ متكرر: "${errText.substring(0, 100)}" — كيف تريد المتابعة؟`);
            if (userAnswer.trim()) {
              history.push({ role: "user", content: `المستخدم يقول: ${userAnswer}\nتابع بناءً على هذه المعلومات.` });
            } else {
              // وقف المهمة إذا لم يرد المستخدم
              this.emitStep(taskId, "WARN", `⏱ لم يرد المستخدم — إيقاف المهمة. الخطأ المتكرر منع الاكتمال.`);
              break;
            }
          } else {
            history.push({ role: "user", content: `أخطاء ظاهرة في الصفحة (المرة ${errorPattern.count}): ${errText}\nالإجراء المقترح: ${errorPattern.suggestedAction}\nحلّل هذا الخطأ وصحّحه أو اطلب من المستخدم بيانات صحيحة باستخدام ask.` });
          }
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

    // ── التعلم من نجاح المهمة (فقط عند نجاح حقيقي) ──────────────────────
    try {
      const finalUrl = await browserAgent.getCurrentUrl();
      // لا تسجّل نجاحاً إذا انتهينا بصفحة فارغة أو خطأ أو موقع خاطئ
      const targetDomain = targetUrl ? new URL(targetUrl).hostname.replace(/^www\./, "") : null;
      const finalDomain = finalUrl && finalUrl.startsWith("http") ? new URL(finalUrl).hostname.replace(/^www\./, "") : null;
      const wrongSite = targetDomain && finalDomain && !finalDomain.includes(targetDomain) && !targetDomain.includes(finalDomain);
      const isRealSuccess = finalUrl &&
        finalUrl !== "about:blank" &&
        finalUrl !== "" &&
        !finalUrl.startsWith("data:") &&
        !verifyResult.includes("تعذّر") &&
        !verifyResult.includes("فشل") &&
        !wrongSite;
      if (isRealSuccess) {
        learningEngine.learnFromSuccessfulNavigation(task.description, finalUrl);
        const taskData = taskStore.getTask(taskId);
        const actionSteps = (taskData?.steps || []).slice(0, 8).map((s: any) => `${s.step}: ${s.content.substring(0, 60)}`);
        learningEngine.learnStrategy(task.description, actionSteps, true);
        learningEngine.recordTaskOutcome(true);
        this.emitStep(taskId, "THINK", `🧠 تعلّمت من هذه المهمة وحفظت الاستراتيجية الناجحة`);
      } else {
        // سجّل الفشل حتى لا يُكرر الوكيل الخطأ
        learningEngine.recordTaskOutcome(false);
        this.emitStep(taskId, "WARN", `⚠️ المهمة لم تكتمل بنجاح — لم يتم حفظ الاستراتيجية`);
      }
    } catch {}

    techIntelligence.onTaskEnd(taskId, true);
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
      ? `\n\nسياق المحادثة السابقة:\n${convHistory.slice(-4).map(m => `${m.role === "user" ? "المستخدم" : "المساعد"}: ${m.content.substring(0, 200)}`).join("\n")}\n`
      : "";

    const prompts: Record<string, string> = {
      OBSERVE: `${convContext}المهمة: "${task.description}"

حلّل هذه المهمة بدقة:
- ما الهدف الرئيسي؟
- ما المعلومات المطلوبة؟
- ما التحديات المحتملة؟
- ما نطاق العمل المطلوب؟`,

      THINK: `بناءً على تحليلك، فكّر في:
- ما أفضل نهج لحل هذه المهمة؟
- ما الخطوات المنطقية المتسلسلة؟
- هل هناك طرق متعددة؟ أيها أفضل ولماذا؟
- ما الاعتبارات الجوهرية؟`,

      PLAN: `ضع خطة تنفيذ مفصّلة ومرقمة لـ: "${task.description}"
اجعل الخطة محددة وقابلة للتنفيذ، مع ذكر المخرجات المتوقعة من كل خطوة.`,

      ACT: `الآن نفّذ المهمة بشكل كامل ومفصّل: "${task.description}"

متطلبات الرد:
✅ قدّم إجابة شاملة ومفصّلة تغطي جميع جوانب المهمة
✅ استخدم Markdown للتنسيق (عناوين، قوائم، كود، جداول)
✅ أضف أمثلة عملية وتطبيقية عند الحاجة
✅ اجعل الرد منظماً وسهل القراءة
✅ لا تختصر - قدّم المعلومات الكاملة والشاملة`,

      VERIFY: `راجع الرد المقدّم وتأكد من:
- هل يجيب على المهمة بالكامل؟
- هل هناك معلومات مفقودة مهمة؟
إذا كان الرد مكتملاً، لخّص النقاط الرئيسية في جملتين أو ثلاث. إذا كان ناقصاً، أكمل ما ينقصه.`,
    };

    const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];
    let finalResult = "";

    for (const step of steps) {
      messages.push({ role: "user", content: prompts[step] });
      const maxTokens = step === "ACT" ? 3500 : step === "VERIFY" ? 1000 : step === "PLAN" ? 800 : 600;
      const temp = step === "ACT" ? 0.4 : 0.3;
      const resp = await smartChat(messages, { temperature: temp, max_tokens: maxTokens, model }, step);
      messages.push({ role: "assistant", content: resp });
      this.emitStep(task.taskId, step, resp);
      if (step === "ACT" || step === "VERIFY") finalResult = resp;
      await sleep(150);
    }

    const duration = Date.now() - start;
    modelSelector.recordResult(model, category, true, duration / 1000, 0.6);

    techIntelligence.onTaskEnd(task.taskId, true);
    taskStore.updateTask(task.taskId, { status: "completed", result: finalResult });
    taskStore.addLog({ taskId: task.taskId, agentType: "AgentRunner", action: "task_complete", output: finalResult.substring(0, 300), durationMs: duration });
    this.emit("taskSuccess", { taskId: task.taskId, result: finalResult });
  }

  // ── وضع المحاكاة (بدون نماذج) ─────────────────────────────────────────

  private async simulateWithSteps(task: Task, start: number): Promise<void> {
    const taskId = task.taskId;

    // إذا كان DeepSeek متاحاً، استخدمه فعلياً
    if (getDeepSeekKey()) {
      await this.runWithPlannerAndAgents(task, start, "deepseek-chat", "default");
      return;
    }

    // لا يوجد أي نموذج — إظهار رسالة واضحة للمستخدم
    this.emitStep(taskId, "OBSERVE", `تحليل المهمة: "${task.description}"`);
    await sleep(400);
    this.emitStep(taskId, "THINK", "فحص الموارد المتاحة...");
    await sleep(400);

    const result = `⚠️ **لا يوجد نموذج ذكاء اصطناعي متاح حالياً**

لتفعيل CortexFlow، اختر أحد الخيارين:

**الخيار 1 — DeepSeek API (موصى به):**
- اذهب إلى الإعدادات ⚙️
- أضف مفتاح DeepSeek API Key
- احصل على مفتاح مجاني من: https://platform.deepseek.com

**الخيار 2 — Ollama (محلي):**
- تأكد من تشغيل Ollama
- نزّل نموذجاً: \`ollama pull qwen2:0.5b\``;

    this.emitStep(taskId, "ACT", result);
    await sleep(300);
    this.emitStep(taskId, "VERIFY", "جاهز للعمل فور إضافة نموذج.");

    taskStore.updateTask(taskId, { status: "completed", result });
    taskStore.addLog({ taskId, agentType: "AgentRunner", action: "task_complete", output: result, durationMs: Date.now() - start });
    this.emit("taskSuccess", { taskId, result });
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

// ── كشف صفحات الأمان الشائعة ومعالجتها تلقائياً ──────────────────────────
// يُعيد: null إذا لا توجد نقطة تفتيش، أو string يصف ما تمّ
async function handleSecurityCheckpoint(
  content: string,
  struct: string,
  emitStep: (type: string, msg: string) => void,
  waitForInput: (question: string) => Promise<string>,
): Promise<string | null> {
  const lc = content.toLowerCase();

  // ── 1. "هل تثق في هذا الجهاز؟" (Facebook / Meta) ───────────────────────
  const isTrustDevice =
    lc.includes("هل تثق في هذا الجهاز") ||
    lc.includes("do you trust this device") ||
    lc.includes("trust this device") ||
    lc.includes("الوثوق بهذا الجهاز");
  if (isTrustDevice) {
    emitStep("ACT", "🔐 كشف صفحة 'الوثوق بالجهاز' — سيتم النقر على الوثوق تلقائياً...");
    const trustTexts = ["الوثوق بهذا الجهاز", "Trust This Device", "Yes, trust", "نعم"];
    for (const t of trustTexts) {
      const clicked = await browserAgent.clickByText(t);
      if (clicked) {
        await sleep(1500);
        return `تمت الموافقة على الوثوق بالجهاز (${t})`;
      }
    }
    // محاولة الزر الأول المتاح
    try {
      await browserAgent.clickBySelector("button");
      await sleep(1500);
      return "تمت الموافقة على الوثوق بالجهاز (زر عام)";
    } catch { }
  }

  // ── 2. رمز التحقق / 2FA ──────────────────────────────────────────────────
  const is2FA =
    lc.includes("رمز التحقق") ||
    lc.includes("verification code") ||
    lc.includes("two-factor") ||
    lc.includes("two factor") ||
    lc.includes("المصادقة الثنائية") ||
    lc.includes("enter the code");
  if (is2FA) {
    emitStep("WARN", "🔑 الموقع يطلب رمز تحقق (2FA) — سيطلب الوكيل الرمز من المستخدم...");
    const code = await waitForInput("يطلب الموقع رمز التحقق الثنائي (2FA). يرجى إدخال الرمز المُرسل إلى هاتفك أو بريدك الإلكتروني:");
    if (code.trim()) {
      const codeField = await browserAgent.smartFill("code", code.trim()) ||
                        await browserAgent.smartFill("verification", code.trim()) ||
                        await browserAgent.smartFill("otp", code.trim());
      if (codeField) {
        await browserAgent.pressKey("Enter");
        await sleep(2000);
        return `تم إدخال رمز 2FA: ${code.trim()}`;
      }
    }
  }

  // ── 3. تأكيد الهوية / Phone verification ─────────────────────────────────
  const isPhoneVerify =
    lc.includes("تأكيد هويتك") ||
    lc.includes("verify your identity") ||
    lc.includes("تحقق من هويتك") ||
    lc.includes("confirm your identity");
  if (isPhoneVerify) {
    emitStep("WARN", "📱 الموقع يطلب تأكيد الهوية — سيطلب الوكيل المساعدة من المستخدم...");
    const answer = await waitForInput("الموقع يطلب تأكيد الهوية. هل تريد المتابعة عبر الهاتف أم البريد الإلكتروني؟ أو أدخل الرمز المطلوب إذا كان لديك:");
    if (answer.trim()) return `تعليمات المستخدم: ${answer}`;
  }

  // ── 4. "متابعة بوصفك ..." (Facebook Continue As) ─────────────────────────
  const isContinueAs = lc.includes("متابعة بوصفك") || lc.includes("continue as");
  if (isContinueAs) {
    emitStep("ACT", "👤 كشف 'متابعة بوصفك...' — النقر تلقائياً...");
    const continueBtnTexts = ["متابعة بوصفك", "Continue as", "Continue"];
    for (const t of continueBtnTexts) {
      if (await browserAgent.clickByText(t)) {
        await sleep(1500);
        return `تمت المتابعة (${t})`;
      }
    }
  }

  // ── 5. قبول ملفات تعريف الارتباط (Cookie consent) ───────────────────────
  const isCookie =
    lc.includes("قبول ملفات") ||
    lc.includes("accept all cookies") ||
    lc.includes("accept cookies") ||
    lc.includes("قبول جميع ملفات");
  if (isCookie) {
    emitStep("ACT", "🍪 كشف موافقة الكوكيز — قبول تلقائي...");
    const acceptTexts = ["قبول الجميع", "قبول الكل", "Accept All", "Accept all cookies", "Allow all", "Agree"];
    for (const t of acceptTexts) {
      if (await browserAgent.clickByText(t)) {
        await sleep(1000);
        return `تم قبول ملفات تعريف الارتباط (${t})`;
      }
    }
  }

  return null;
}

async function executeAction(
  action: string,
  param: string,
): Promise<{ success: boolean; error?: string } | undefined> {
  switch (action) {
    case "navigate": {
      console.log(`[ACT] navigate → ${param}`);
      await browserAgent.navigate(param);
      await browserAgent.captureNow();
      const newUrl = await browserAgent.getCurrentUrl();
      console.log(`[ACT] navigate ✅ وصل إلى: ${newUrl}`);
      return { success: true };
    }
    case "click": {
      // دعم النقر المباشر بـ CSS selector: click PARAM: sel:CSS_SELECTOR
      if (param.startsWith("sel:")) {
        const cssSelector = param.slice(4).trim();
        console.log(`[ACT] click[sel] → "${cssSelector}"`);
        const clickedSel = await browserAgent.clickByAnySelector([cssSelector]);
        if (!clickedSel) {
          console.log(`[ACT] click[sel] ❌ لم يُعثر على: "${cssSelector}"`);
          return { success: false, error: `لم يُعثر على عنصر بالـ selector: "${cssSelector}"` };
        }
        console.log(`[ACT] click[sel] ✅ نجح: "${cssSelector}"`);
        return { success: true };
      }

      console.log(`[ACT] click[text] → "${param}"`);
      const clicked = await browserAgent.clickByText(param);
      if (!clicked) {
        // الاحتياطي الذكي: يسأل DeepSeek عن العنصر الصحيح بناءً على قائمة كل العناصر
        console.log(`[ACT] click[text] ❌ فشل "${param}" — تشغيل AI-assisted click...`);
        const { success: aiClicked, selector: aiSel } = await browserAgent.aiAssistedClick(
          param,
          async (prompt) => {
            const DEEPSEEK_KEY = getDeepSeekKey();
            if (!DEEPSEEK_KEY) return "";
            return deepseekChat([
              { role: "system", content: "أنت مساعد لتحديد عناصر صفحات الويب. أجب بـ JSON فقط بلا أي نص إضافي." },
              { role: "user", content: prompt },
            ], 300, 0.1);
          },
        );
        if (aiClicked) {
          console.log(`[ACT] click[ai] ✅ نجح باستخدام: "${aiSel}"`);
          return { success: true };
        }
        // آخر احتياطي: اضغط Enter
        console.log(`[ACT] click ❌ فشل كلياً لـ "${param}" — ضغط Enter كاحتياطي`);
        try {
          await browserAgent.pressKey("Enter");
          return { success: true };
        } catch { }
        return { success: false, error: `لم يُعثر على عنصر بالنص: "${param}" — جرّب: click PARAM: sel:CSS_SELECTOR أو key PARAM: Enter` };
      }
      console.log(`[ACT] click[text] ✅ نجح: "${param}"`);
      return { success: true };
    }
    case "fill": {
      const eqIdx = param.indexOf("=");
      if (eqIdx === -1) return { success: false, error: `صيغة خاطئة — يجب أن تكون: اسم_الحقل=القيمة` };
      const field = param.substring(0, eqIdx).trim();
      const value = param.substring(eqIdx + 1).trim();
      console.log(`[ACT] fill → "${field}" = "${value.slice(0, 30)}${value.length > 30 ? "..." : ""}"`);
      const filled = await browserAgent.smartFill(field, value);
      if (!filled) {
        console.log(`[ACT] fill ❌ لم يُعثر على الحقل: "${field}"`);
        return { success: false, error: `لم يُعثر على الحقل "${field}" في الصفحة. راجع هيكل الصفحة لمعرفة الأسماء الصحيحة.` };
      }
      // ── ضغط Enter تلقائي بعد ملء حقل كلمة المرور ──────────────────────
      const passwordHints = ["password", "pass", "كلمة المرور", "كلمة_المرور", "مرور", "passwd", "pwd"];
      const isPasswordField = passwordHints.some(k => field.toLowerCase().includes(k));
      if (isPasswordField) {
        await sleep(400);
        await browserAgent.pressKey("Enter");
        await sleep(1500);
        await browserAgent.captureNow();
        console.log(`[ACT] fill ✅ "${field}" + Enter تلقائي (حقل كلمة المرور)`);
      } else {
        console.log(`[ACT] fill ✅ "${field}"`);
      }
      return { success: true };
    }
    case "select": {
      const eqIdx2 = param.indexOf("=");
      if (eqIdx2 === -1) return { success: false, error: `صيغة خاطئة — يجب أن تكون: اسم_القائمة=الخيار` };
      // لا تحذف nth:N — فقط نظّف المسافات الزائدة
      const selField = param.substring(0, eqIdx2).trim();
      const selValue = param.substring(eqIdx2 + 1).trim();
      console.log(`[ACT] select → "${selField}" = "${selValue}"`);
      const selected = await browserAgent.smartSelect(selField, selValue);
      if (!selected) {
        console.log(`[ACT] select ❌ لم يُعثر على: "${selField}" = "${selValue}"`);
        return { success: false, error: `لم يُعثر على القائمة "${selField}" أو الخيار "${selValue}".` };
      }
      console.log(`[ACT] select ✅ "${selField}" = "${selValue}"`);
      return { success: true };
    }
    case "type":
      console.log(`[ACT] type → "${param.slice(0, 50)}"`);
      await browserAgent.type(param);
      return { success: true };
    case "key":
      console.log(`[ACT] key → "${param}"`);
      await browserAgent.pressKey(param);
      return { success: true };
    case "scroll":
      console.log(`[ACT] scroll → "${param}"`);
      await browserAgent.scroll(0, param === "up" ? -400 : 400);
      return { success: true };
    case "wait":
      console.log(`[ACT] wait → 2s`);
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
    "واتساب شخصي": "https://web.whatsapp.com", "whatsapp personal": "https://web.whatsapp.com",
    "ويكيبيديا": "https://ar.wikipedia.org", "wikipedia": "https://en.wikipedia.org",
    "ستاك اوفرفلو": "https://stackoverflow.com", "stackoverflow": "https://stackoverflow.com",
    "ميتا للمطورين": "https://developers.facebook.com/",
    "ميتا الخاص بالمطورين": "https://developers.facebook.com/",
    "موقع ميتا الخاص بالمطورين": "https://developers.facebook.com/",
    "ميتا مطورين": "https://developers.facebook.com/",
    "ميتا developer": "https://developers.facebook.com/",
    "meta developer": "https://developers.facebook.com/",
    "meta for developers": "https://developers.facebook.com/",
    "developers.facebook": "https://developers.facebook.com/",
    "whatsapp cloud api": "https://developers.facebook.com/docs/whatsapp/cloud-api/",
    "whatsapp business api": "https://developers.facebook.com/docs/whatsapp/",
    "واتساب بيزنس api": "https://developers.facebook.com/docs/whatsapp/",
    "واتساب للأعمال api": "https://developers.facebook.com/docs/whatsapp/",
    "إنشاء تطبيق واتساب": "https://developers.facebook.com/",
    "انشاء تطبيق واتساب": "https://developers.facebook.com/",
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
