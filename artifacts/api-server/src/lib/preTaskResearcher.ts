/**
 * preTaskResearcher.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * نظام البحث المسبق + مكافحة الهلوسة + الاستدلال الإلزامي + تتبع الأهداف
 *
 * الطبقات:
 * 1. تحليل التعقيد ومراجعة المعرفة
 * 2. قاعدة معرفة المنصات (Platform Playbooks)
 * 3. تتبع الأهداف الفرعية (SubGoal Tracker)
 * 4. الاستدلال الإلزامي قبل كل إجراء
 * 5. التحقق من نتيجة الإجراء بعد تنفيذه
 * 6. تتبع أنماط الأخطاء والتصعيد التلقائي
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ══════════════════════════════════════════════════════════════════════════════
// الطبقة 1: تحليل التعقيد ومراجعة المعرفة
// ══════════════════════════════════════════════════════════════════════════════

export interface TaskComplexityScore {
  score: number;
  isComplex: boolean;
  reasons: string[];
  category: "simple" | "moderate" | "complex" | "multi-step-auth";
}

export interface KnowledgeAudit {
  known: string[];
  assumed: string[];
  unknown: string[];
  prerequisites: string[];
  knownFailurePoints: string[];
}

export interface RealityChecklist {
  items: RealityCheckItem[];
}

export interface RealityCheckItem {
  criterion: string;
  howToVerify: string;
  mustBeVisible: string;
}

export function analyzeTaskComplexity(taskDescription: string): TaskComplexityScore {
  const desc = taskDescription.toLowerCase();
  let score = 1;
  const reasons: string[] = [];

  const signals: Array<{ keywords: string[]; points: number; reason: string }> = [
    { keywords: ["تسجيل دخول", "login", "sign in", "بريد", "كلمة مرور", "password"], points: 2, reason: "تتطلب مصادقة" },
    { keywords: ["أنشئ", "create", "register", "سجّل", "إنشاء"], points: 1, reason: "تتطلب إنشاء شيء" },
    { keywords: ["api", "مفتاح", "token", "access token", "webhook"], points: 2, reason: "تتطلب بيانات API" },
    { keywords: ["meta", "facebook", "ميتا", "فيسبوك"], points: 2, reason: "منصة Meta — تحقق متعدد المراحل" },
    { keywords: ["google", "جوجل", "gmail"], points: 2, reason: "Google — 2FA وحماية متقدمة" },
    { keywords: ["whatsapp", "واتساب", "business"], points: 2, reason: "WhatsApp Business — متطلبات تحقق خاصة" },
    { keywords: ["captcha", "recaptcha", "تحقق"], points: 2, reason: "قد تحتاج تحقق بشري" },
    { keywords: ["رقم هاتف", "phone number", "otp", "sms"], points: 2, reason: "تحقق برقم الهاتف" },
    { keywords: ["دفع", "payment", "credit card", "billing"], points: 3, reason: "بيانات دفع مطلوبة" },
    { keywords: ["واتساب أعمال", "whatsapp business api", "waba"], points: 3, reason: "WhatsApp Business API — متطلبات تجارية معقدة" },
    { keywords: ["ثم", "بعد ذلك", "ثم انتقل", "خطوات متعددة"], points: 1, reason: "مهمة متعددة الخطوات" },
    { keywords: ["انشاء تطبيق", "create app", "new app"], points: 1, reason: "إنشاء تطبيق على منصة" },
    { keywords: ["instagram", "انستقرام"], points: 2, reason: "Instagram — قيود على الأتمتة" },
    { keywords: ["twitter", "x.com", "تويتر"], points: 2, reason: "Twitter/X — قيود على الأتمتة" },
    { keywords: ["linkedin", "لينكد إن"], points: 2, reason: "LinkedIn — حماية متقدمة" },
  ];

  for (const s of signals) {
    if (s.keywords.some(k => desc.includes(k))) {
      score += s.points;
      reasons.push(s.reason);
    }
  }

  score = Math.min(10, score);
  let category: TaskComplexityScore["category"] = "simple";
  if (score >= 3 && score < 6) category = "moderate";
  if (score >= 6 && score < 8) category = "complex";
  if (score >= 8) category = "multi-step-auth";

  return { score, isComplex: score >= 6, reasons: [...new Set(reasons)], category };
}

export function buildKnowledgeAudit(taskDescription: string, complexity: TaskComplexityScore): KnowledgeAudit {
  const desc = taskDescription.toLowerCase();
  const audit: KnowledgeAudit = { known: [], assumed: [], unknown: [], prerequisites: [], knownFailurePoints: [] };

  audit.known.push("الوكيل يتحكم في متصفح حقيقي");
  audit.known.push("كل إجراء مبني على ما يظهر على الشاشة فعلاً");

  if (desc.includes("meta") || desc.includes("ميتا") || desc.includes("facebook") || desc.includes("فيسبوك")) {
    audit.known.push("Meta Developers تتطلب حساب Facebook نشطاً مربوطاً بحساب Business");
    audit.assumed.push("المستخدم لديه حساب Facebook مفعّل ومعتمد كمطوّر");
    audit.unknown.push("بيانات الدخول (البريد + كلمة المرور)");
    audit.prerequisites.push("حساب Facebook نشط ومعتمد");
    audit.prerequisites.push("حساب Meta Business Manager موجود مسبقاً");
    audit.knownFailurePoints.push("طلب إعادة إدخال كلمة المرور عند الحساسية الأمنية");
    audit.knownFailurePoints.push("قيود على إنشاء تطبيقات جديدة للحسابات الجديدة");
    audit.knownFailurePoints.push("CAPTCHA أو تحقق بالهاتف يظهر فجأة");
  }

  if (desc.includes("whatsapp") || desc.includes("واتساب") || desc.includes("waba")) {
    audit.known.push("WhatsApp Business API يتطلب حساب WhatsApp Business مسجلاً رسمياً");
    audit.assumed.push("المستخدم لديه رقم هاتف يدعم WhatsApp Business");
    audit.unknown.push("رقم الهاتف التجاري المراد ربطه");
    audit.prerequisites.push("رقم هاتف نشط يمكن استخدامه مع WhatsApp Business");
    audit.prerequisites.push("حساب WhatsApp Business Manager مربوط بـ Meta Business");
    audit.knownFailurePoints.push("الأرقام الشخصية لا تعمل مع Business API");
    audit.knownFailurePoints.push("صفحة App Publish Status تظهر ولا تمنع العمل — تجاهلها وتابع");
    audit.knownFailurePoints.push("التحقق من رقم الهاتف يستغرق وقتاً");
  }

  if (desc.includes("api") || desc.includes("مفتاح")) {
    audit.assumed.push("الـ API سيُتاح فور إنشاء التطبيق");
    audit.knownFailurePoints.push("بعض الـ APIs تحتاج مراجعة من المنصة قبل التفعيل");
    audit.knownFailurePoints.push("الـ Access Token يتغير وله صلاحية محدودة");
  }

  if (desc.includes("google") || desc.includes("gmail") || desc.includes("جوجل")) {
    audit.known.push("Google تستخدم 2FA بشكل شبه إلزامي");
    audit.unknown.push("بيانات الدخول لحساب Google");
    audit.prerequisites.push("حساب Google مفعّل");
    audit.knownFailurePoints.push("رمز تحقق على الهاتف");
    audit.knownFailurePoints.push("reCAPTCHA قد يظهر");
  }

  if (complexity.score >= 6) {
    audit.assumed.push("كل الخطوات ستكتمل بنجاح بالترتيب");
    audit.knownFailurePoints.push("الفشل في خطوة مبكرة يُعطّل كل الخطوات اللاحقة");
  }

  return audit;
}

export function buildRealityChecklist(taskDescription: string): RealityChecklist {
  const desc = taskDescription.toLowerCase();
  const items: RealityCheckItem[] = [];

  if ((desc.includes("meta") || desc.includes("facebook") || desc.includes("ميتا")) && (desc.includes("تطبيق") || desc.includes("app"))) {
    items.push({ criterion: "تم إنشاء التطبيق", howToVerify: "App ID يظهر في صفحة الإعدادات", mustBeVisible: "App ID: [أرقام] في developers.facebook.com/apps/" });
  }

  if (desc.includes("whatsapp") || desc.includes("واتساب")) {
    items.push({ criterion: "تم إضافة منتج WhatsApp", howToVerify: "WhatsApp في القائمة الجانبية اليسرى", mustBeVisible: "WhatsApp في sidebar داخل صفحة التطبيق" });
    items.push({ criterion: "ظهر رمز الوصول (Access Token)", howToVerify: "نص يبدأ بـ EAA أو حقل Access Token", mustBeVisible: "Temporary Access Token أو حقل token" });
  }

  if (desc.includes("تسجيل دخول") || desc.includes("login") || desc.includes("sign in")) {
    items.push({ criterion: "تم تسجيل الدخول", howToVerify: "اسم المستخدم أو صورته في الصفحة", mustBeVisible: "اسم الحساب أو أيقونة الحساب في الشريط العلوي" });
  }

  items.push({ criterion: "الصفحة الحالية تُثبت اكتمال المهمة", howToVerify: "URL ومحتوى الصفحة يتطابقان مع هدف المهمة", mustBeVisible: "رسالة نجاح أو عنصر يدل على اكتمال ما طُلب" });

  return { items };
}

// ══════════════════════════════════════════════════════════════════════════════
// الطبقة 2: قاعدة معرفة المنصات (Platform Playbooks)
// ══════════════════════════════════════════════════════════════════════════════

export interface PlatformPlaybook {
  platform: string;
  matchKeywords: string[];
  startUrl: string;
  knownFlow: string[];
  commonErrors: Array<{ error: string; meaning: string; fix: string }>;
  cannotAutomate: string[];
  requiredFromUser: string[];
  completionSignals: string[];
}

const PLATFORM_PLAYBOOKS: PlatformPlaybook[] = [
  {
    platform: "Meta Developers (WhatsApp Business API)",
    matchKeywords: ["meta", "ميتا", "facebook", "whatsapp business api", "واتساب أعمال", "developers.facebook"],
    startUrl: "https://developers.facebook.com/",
    knownFlow: [
      "1. الذهاب إلى developers.facebook.com والتأكد من تسجيل الدخول",
      "2. النقر على 'My Apps' أو 'تطبيقاتي' في الشريط العلوي",
      "3. النقر على 'Create App' أو 'إنشاء تطبيق'",
      "4. اختيار نوع التطبيق 'Business' — ليس 'Consumer'",
      "5. إدخال اسم التطبيق (اسم فريد) والبريد الإلكتروني",
      "6. قد تظهر نافذة تأكيد كلمة المرور — أدخل كلمة مرور Facebook",
      "7. بعد إنشاء التطبيق: النقر على 'Add Product' أو 'إضافة منتج'",
      "8. اختيار 'WhatsApp' من قائمة المنتجات",
      "9. اتباع إعداد WhatsApp Business API",
      "10. ستجد Temporary Access Token في صفحة إعداد WhatsApp",
    ],
    commonErrors: [
      { error: "App Publish Status", meaning: "تنبيه بأن التطبيق غير منشور — طبيعي جداً للتطبيقات الجديدة", fix: "تجاهله واستمر في الخطوات" },
      { error: "This account has been suspended", meaning: "الحساب موقوف", fix: "أبلغ المستخدم — لا يمكن المتابعة" },
      { error: "You need a Business Portfolio", meaning: "يحتاج حساب Business Manager", fix: "الذهاب إلى business.facebook.com أولاً لإنشاء حساب Business" },
      { error: "Invalid redirect_uri", meaning: "خطأ في إعداد OAuth", fix: "تجاهله في مرحلة الإنشاء الأولى" },
    ],
    cannotAutomate: [
      "التحقق عبر رمز SMS يُرسل للهاتف",
      "CAPTCHA اليدوي",
      "إدخال كلمة مرور Facebook (يجب أن يزودها المستخدم)",
      "قبول الشروط والأحكام (يحتاج قراءة المستخدم)",
    ],
    requiredFromUser: [
      "بيانات تسجيل الدخول لـ Facebook",
      "اسم التطبيق المطلوب",
      "رقم الهاتف التجاري المراد ربطه",
    ],
    completionSignals: [
      "ظهور App ID في صفحة الإعدادات: App ID: [أرقام]",
      "WhatsApp يظهر في القائمة الجانبية اليسرى",
      "ظهور 'Temporary Access Token' في صفحة WhatsApp Setup",
    ],
  },
  {
    platform: "Google Cloud / Google APIs",
    matchKeywords: ["google cloud", "google api", "google developer", "console.cloud.google", "جوجل كلاود"],
    startUrl: "https://console.cloud.google.com/",
    knownFlow: [
      "1. الذهاب إلى console.cloud.google.com",
      "2. تسجيل الدخول بحساب Google",
      "3. إنشاء مشروع جديد أو اختيار مشروع موجود",
      "4. الذهاب إلى APIs & Services > Library",
      "5. البحث عن الـ API المطلوب وتفعيله",
      "6. الذهاب إلى Credentials > Create Credentials",
      "7. اختيار نوع المفتاح (API Key / OAuth / Service Account)",
    ],
    commonErrors: [
      { error: "Billing account required", meaning: "يحتاج حساب فوترة", fix: "أبلغ المستخدم — يجب إضافة بطاقة ائتمانية" },
      { error: "Quota exceeded", meaning: "تجاوز حد الاستخدام", fix: "أبلغ المستخدم لترقية الخطة" },
    ],
    cannotAutomate: [
      "إضافة بطاقة ائتمانية لحساب Billing",
      "التحقق برمز SMS",
      "إدخال كلمة مرور Google",
    ],
    requiredFromUser: [
      "بيانات تسجيل الدخول لـ Google",
      "اسم المشروع",
    ],
    completionSignals: [
      "ظهور Project ID في الصفحة",
      "ظهور API Key أو رمز Credentials",
    ],
  },
  {
    platform: "GitHub",
    matchKeywords: ["github", "جيت هاب", "repository", "repo", "مستودع"],
    startUrl: "https://github.com/",
    knownFlow: [
      "1. الذهاب إلى github.com وتسجيل الدخول",
      "2. النقر على '+' في الأعلى لإنشاء مستودع جديد",
      "3. إدخال اسم المستودع",
      "4. اختيار Public أو Private",
      "5. النقر على 'Create repository'",
    ],
    commonErrors: [
      { error: "Repository already exists", meaning: "اسم المستودع محجوز", fix: "استخدم اسماً مختلفاً" },
      { error: "Two-factor authentication required", meaning: "تحقق ثنائي مطلوب", fix: "أبلغ المستخدم للتحقق من هاتفه" },
    ],
    cannotAutomate: [
      "التحقق ثنائي (2FA)",
      "إدخال كلمة مرور GitHub",
    ],
    requiredFromUser: [
      "بيانات تسجيل الدخول",
      "اسم المستودع",
    ],
    completionSignals: [
      "ظهور الـ URL الجديد: github.com/username/repo-name",
      "ظهور صفحة المستودع الفارغة مع زر 'Add a README'",
    ],
  },
  {
    platform: "Instagram Business / Creator",
    matchKeywords: ["instagram", "انستقرام", "instagram business"],
    startUrl: "https://www.instagram.com/",
    knownFlow: [
      "1. الذهاب إلى instagram.com أو business.instagram.com",
      "2. تسجيل الدخول",
      "3. الذهاب إلى الإعدادات > الحساب",
      "4. التبديل إلى حساب Business أو Creator",
    ],
    commonErrors: [
      { error: "We detected unusual activity", meaning: "حماية أمنية مفعّلة", fix: "أبلغ المستخدم — يحتاج تأكيداً يدوياً" },
    ],
    cannotAutomate: [
      "تأكيد الهوية عبر صورة",
      "كلمة المرور",
    ],
    requiredFromUser: ["بيانات تسجيل الدخول"],
    completionSignals: [
      "ظهور 'Business Account' في الإعدادات",
    ],
  },
];

/**
 * العثور على Playbook المناسب للمهمة
 */
export function findPlatformPlaybook(taskDescription: string): PlatformPlaybook | null {
  const desc = taskDescription.toLowerCase();
  for (const pb of PLATFORM_PLAYBOOKS) {
    if (pb.matchKeywords.some(k => desc.includes(k))) {
      return pb;
    }
  }
  return null;
}

/**
 * بناء system prompt يتضمن معرفة المنصة
 */
export function buildPlatformAwarePrompt(playbook: PlatformPlaybook): string {
  return [
    `## 📚 معرفة مُدمجة بالمنصة: ${playbook.platform}`,
    ``,
    `### سير العمل الصحيح المُعتمد:`,
    playbook.knownFlow.join("\n"),
    ``,
    `### الأخطاء الشائعة وتفسيرها:`,
    playbook.commonErrors.map(e => `- "${e.error}" → ${e.meaning} → الحل: ${e.fix}`).join("\n"),
    ``,
    `### لا يمكن أتمتته (يحتاج المستخدم):`,
    playbook.cannotAutomate.map(c => `- ${c}`).join("\n"),
    ``,
    `### علامات الاكتمال الحقيقي:`,
    playbook.completionSignals.map(s => `✓ ${s}`).join("\n"),
  ].join("\n");
}

// ══════════════════════════════════════════════════════════════════════════════
// الطبقة 3: تتبع الأهداف الفرعية
// ══════════════════════════════════════════════════════════════════════════════

export interface SubGoal {
  id: number;
  title: string;
  completionSignal: string;
  status: "pending" | "in_progress" | "done" | "failed";
  evidence?: string;
  attemptCount: number;
}

export class SubGoalTracker {
  private goals: SubGoal[] = [];
  private currentGoalIndex = 0;

  initialize(steps: string[]): void {
    this.goals = steps.map((s, i) => ({
      id: i + 1,
      title: s,
      completionSignal: "",
      status: "pending" as const,
      attemptCount: 0,
    }));
    if (this.goals.length > 0) {
      this.goals[0].status = "in_progress";
    }
  }

  getCurrentGoal(): SubGoal | null {
    return this.goals[this.currentGoalIndex] || null;
  }

  markCurrentDone(evidence: string): void {
    const g = this.goals[this.currentGoalIndex];
    if (g) {
      g.status = "done";
      g.evidence = evidence;
      this.currentGoalIndex++;
      if (this.currentGoalIndex < this.goals.length) {
        this.goals[this.currentGoalIndex].status = "in_progress";
      }
    }
  }

  markCurrentFailed(reason: string): void {
    const g = this.goals[this.currentGoalIndex];
    if (g) {
      g.status = "failed";
      g.evidence = reason;
    }
  }

  incrementAttempt(): void {
    const g = this.goals[this.currentGoalIndex];
    if (g) g.attemptCount++;
  }

  isAllDone(): boolean {
    return this.goals.every(g => g.status === "done");
  }

  getProgressReport(): string {
    const done = this.goals.filter(g => g.status === "done").length;
    const total = this.goals.length;
    const lines = [
      `## تقرير التقدم: ${done}/${total} أهداف مكتملة`,
      ...this.goals.map(g => {
        const icon = g.status === "done" ? "✅" : g.status === "in_progress" ? "▶️" : g.status === "failed" ? "❌" : "⏳";
        return `${icon} [${g.id}] ${g.title}${g.evidence ? ` (${g.evidence.substring(0, 60)})` : ""}`;
      }),
    ];
    return lines.join("\n");
  }

  getCurrentGoalContext(): string {
    const g = this.getCurrentGoal();
    if (!g) return "جميع الأهداف مكتملة";
    return [
      `### الهدف الفرعي الحالي [${g.id}/${this.goals.length}]: ${g.title}`,
      `المحاولات حتى الآن: ${g.attemptCount}`,
      g.attemptCount >= 4 ? `⚠️ تحذير: هذا الهدف يستغرق وقتاً طويلاً — فكّر في نهج مختلف` : "",
    ].filter(Boolean).join("\n");
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// الطبقة 4: الاستدلال الإلزامي قبل كل إجراء
// ══════════════════════════════════════════════════════════════════════════════

/**
 * يولّد prompt يُجبر الوكيل على الاستدلال قبل التصرف
 * التنسيق الجديد:
 *   THINK: [ما أراه + ما أتوقعه + لماذا هذا الإجراء]
 *   ACTION: <action> | PARAM: <value>
 */
export const REASONING_ACTION_SYSTEM_PROMPT = `أنت وكيل أتمتة متصفح محترف مع قدرة على التفكير النقدي.

في كل استجابة أخرج سطرين فقط بهذا التنسيق الثابت:
THINK: <ما أراه في الصفحة الآن> | <ما أتوقع أن يحدث> | <لماذا هذا الإجراء صحيح>
ACTION: <الإجراء> | PARAM: <القيمة>

الإجراءات المتاحة:
  navigate  - الانتقال إلى رابط URL: PARAM: https://...
  click     - النقر على عنصر: PARAM: نص_الزر
             أو CSS selector: PARAM: sel:#id أو sel:.class
  fill      - ملء حقل نصي: PARAM: اسم_الحقل=القيمة
  select    - اختيار من قائمة: PARAM: اسم_القائمة=الخيار
  ask       - اطلب من المستخدم: PARAM: وصف ما تحتاجه
  key       - ضغط مفتاح: PARAM: Enter أو Tab أو Escape
  scroll    - التمرير: PARAM: up أو down
  wait      - انتظار تحميل: PARAM: waiting
  done      - المهمة مكتملة (بعد رؤية الدليل الملموس): PARAM: وصف الدليل المرئي

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 قاعدة التفكير الإلزامي
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
في سطر THINK يجب أن تذكر:
1. ما الذي أراه الآن في هيكل الصفحة (لا تخمّن — اقرأ من الهيكل)
2. ما الذي أتوقع أن يحدث بعد هذا الإجراء
3. لماذا هذا الإجراء هو الصحيح الآن

مثال صحيح:
THINK: أرى زر "Create App" في هيكل الصفحة | بعد النقر سأنتقل لنموذج إنشاء تطبيق | هذا الخطوة التالية في الخطة
ACTION: click | PARAM: Create App

مثال خاطئ (لا تفعل هذا):
THINK: سأنقر على الزر | قد يعمل | لأن الخطة تقول ذلك
ACTION: click | PARAM: Create App

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚫 قواعد مكافحة الهلوسة الصارمة
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. لا تخترع روابط بـ IDs لم تظهر في هيكل الصفحة الحالية
2. لا تقل done إلا إذا رأيت الدليل الملموس مكتوباً في هيكل الصفحة
3. إذا تكرر نفس الخطأ 3 مرات → استخدم ask لإبلاغ المستخدم
4. لا تكرر نفس الإجراء 3 مرات بدون تغيير
5. كل معلومة تستخدمها يجب أن تكون مرئية في الصفحة أو مأخوذة من المستخدم

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 قاعدة done الصارمة
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- done يعني أن الدليل الملموس مكتوب في هيكل الصفحة الآن
- الدليل المطلوب مذكور في قسم "دليل الاكتمال" في التعليمات
- في PARAM اذكر بالضبط ما رأيته في الصفحة كدليل

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 قواعد الإجراءات
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- fill: استخدم اسم الحقل من هيكل الصفحة
- select: استخدم nth:0=الخيار (رقم القائمة من الهيكل)
- click: استخدم النص المرئي أو sel:CSS_selector
- navigate: انتقل فقط إلى روابط مرئية في الصفحة أو بدأت الجلسة بها
- ask: للبيانات الحساسة التي لا يمكن معرفتها (كلمة المرور، رمز OTP)

سطران فقط — لا شرح إضافي ولا تعليق.`;

/**
 * تحليل سطر THINK من رد الوكيل
 */
export function parseReasoningLine(raw: string): { think: string; action: string; param: string } | null {
  const thinkMatch = raw.match(/THINK:\s*(.+)/i);
  const actionMatch = raw.match(/ACTION:\s*(\w+)\s*\|\s*PARAM:\s*(.+)/i);

  if (!actionMatch) return null;

  return {
    think: thinkMatch ? thinkMatch[1].trim() : "",
    action: actionMatch[1].trim().toLowerCase(),
    param: actionMatch[2].trim(),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// الطبقة 5: التحقق من نتيجة الإجراء بعد تنفيذه
// ══════════════════════════════════════════════════════════════════════════════

export interface ActionOutcome {
  expected: string;
  actual: string;
  matched: boolean;
  confidence: number; // 0-1
}

/**
 * بناء prompt للتحقق من نتيجة إجراء بعد تنفيذه
 */
export function buildPostActionVerifyPrompt(
  action: string,
  param: string,
  thinkLine: string,
  newUrl: string,
  newPageStruct: string,
  currentGoal: string,
): string {
  return `أنت محكّم سريع للتحقق من نتيجة إجراء.

## الإجراء المُنفَّذ
الإجراء: ${action}
القيمة: ${param}
ما توقعه الوكيل: ${thinkLine}

## الحالة بعد التنفيذ
URL الجديد: ${newUrl}
هيكل الصفحة (أول 600 حرف):
${newPageStruct.substring(0, 600)}

## الهدف الفرعي الحالي
${currentGoal}

## السؤال
هل الإجراء حقق ما كان متوقعاً؟ هل تقدمنا نحو الهدف الفرعي؟

أجب بـ JSON فقط:
{
  "success": true/false,
  "progress": "وصف التقدم المُحرَّز أو عدمه",
  "subGoalDone": true/false,
  "evidence": "الدليل المرئي على النتيجة",
  "nextSuggestion": "الخطوة التالية المقترحة إذا لم ينجح"
}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// الطبقة 6: تتبع أنماط الأخطاء والتصعيد
// ══════════════════════════════════════════════════════════════════════════════

export interface ErrorPattern {
  errorText: string;
  count: number;
  firstSeen: number;
  category: "auth" | "permission" | "not_found" | "ui" | "network" | "known_ignorable" | "unknown";
  suggestedAction: string;
  shouldEscalate: boolean;
}

export class ErrorPatternTracker {
  private patterns: Map<string, ErrorPattern> = new Map();
  private readonly ESCALATE_THRESHOLD = 3;

  record(errorText: string): ErrorPattern {
    const key = this.normalizeError(errorText);
    const existing = this.patterns.get(key);

    if (existing) {
      existing.count++;
      return existing;
    }

    const pattern: ErrorPattern = {
      errorText,
      count: 1,
      firstSeen: Date.now(),
      category: this.categorizeError(errorText),
      suggestedAction: this.suggestAction(errorText),
      shouldEscalate: false,
    };
    pattern.shouldEscalate = pattern.category !== "known_ignorable";
    this.patterns.set(key, pattern);
    return pattern;
  }

  isRepeating(errorText: string): boolean {
    const p = this.patterns.get(this.normalizeError(errorText));
    if (!p) return false;
    return p.count >= this.ESCALATE_THRESHOLD && p.shouldEscalate;
  }

  getEscalationMessage(errorText: string): string {
    const p = this.patterns.get(this.normalizeError(errorText));
    if (!p) return "";
    return [
      `⛔ الخطأ تكرر ${p.count} مرات ولم يُحَل`,
      `النوع: ${p.category}`,
      `الإجراء المطلوب: ${p.suggestedAction}`,
    ].join("\n");
  }

  private normalizeError(text: string): string {
    return text.toLowerCase().replace(/\s+/g, " ").substring(0, 60);
  }

  private categorizeError(text: string): ErrorPattern["category"] {
    const t = text.toLowerCase();
    // الأخطاء التي يجب تجاهلها (طبيعية)
    if (t.includes("app publish status") || t.includes("publish status")) return "known_ignorable";
    if (t.includes("password") || t.includes("login") || t.includes("unauthorized") || t.includes("كلمة مرور")) return "auth";
    if (t.includes("permission") || t.includes("صلاحية") || t.includes("not allowed") || t.includes("forbidden")) return "permission";
    if (t.includes("not found") || t.includes("404") || t.includes("لم يُعثر")) return "not_found";
    if (t.includes("network") || t.includes("timeout") || t.includes("connection")) return "network";
    return "ui";
  }

  private suggestAction(text: string): string {
    const cat = this.categorizeError(text);
    if (cat === "known_ignorable") return "هذا الخطأ طبيعي — تجاهله واستمر";
    const s: Record<string, string> = {
      auth: "اطلب من المستخدم إعادة إدخال بيانات الدخول",
      permission: "هذه المهمة تتطلب صلاحيات إضافية — أبلغ المستخدم",
      not_found: "الصفحة أو العنصر غير موجود — راجع الرابط",
      network: "مشكلة اتصال — انتظر وأعد المحاولة مرة واحدة",
      ui: "العنصر غير موجود في الصفحة — راجع هيكل الصفحة",
      unknown: "خطأ غير معروف — أبلغ المستخدم بالكامل",
    };
    return s[cat] || s.unknown;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// دوال مساعدة
// ══════════════════════════════════════════════════════════════════════════════

/**
 * كاشف الروابط المخترعة
 */
export function detectFabricatedUrl(url: string, pageContent: string, pageStructure: string): boolean {
  if (!url || !url.startsWith("http")) return false;
  const urlIdMatch = url.match(/\/(\d{10,})\//);
  if (urlIdMatch) {
    const id = urlIdMatch[1];
    return !pageContent.includes(id) && !pageStructure.includes(id);
  }
  return false;
}

/**
 * بناء prompt البحث المسبق للمهام المعقدة
 */
export function buildPreResearchPrompt(
  taskDescription: string,
  complexity: TaskComplexityScore,
  audit: KnowledgeAudit,
  checklist: RealityChecklist,
): string {
  return `أنت خبير في أتمتة المواقع. حلل المهمة التالية قبل التنفيذ.

## المهمة
${taskDescription}

## درجة التعقيد: ${complexity.score}/10 (${complexity.category})
${complexity.reasons.join(" | ")}

## ما نعرفه / ما نفترضه / ما لا نعرفه
معروف: ${audit.known.join(" | ")}
مفترض: ${audit.assumed.join(" | ")}
مجهول: ${audit.unknown.join(" | ")}

## نقاط الفشل المعروفة
${audit.knownFailurePoints.join("\n")}

## دليل الاكتمال المطلوب
${checklist.items.map(i => `- ${i.mustBeVisible}`).join("\n")}

أجب بـ JSON فقط:
{
  "preChecks": ["تحقق من هذا قبل البدء"],
  "warningToUser": "تحذير موجز إذا كانت المهمة قد تفشل جزئياً",
  "realSteps": ["خطوات واقعية مبنية على كيفية عمل المنصة فعلاً"],
  "completionProof": ["ما يجب أن يكون مرئياً على الشاشة — كن دقيقاً"],
  "cannotBeAutomated": ["جوانب تحتاج تدخل يدوي من المستخدم"]
}`;
}

/**
 * بناء prompt التحقق المُعزَّز عند "done"
 */
export function buildDoneVerificationPrompt(
  taskDescription: string,
  checklist: RealityChecklist,
  currentUrl: string,
  pageContent: string,
): string {
  return `أنت محكّم صارم. لا تقبل الاكتمال إلا بدليل مرئي في النص المُعطى.

## المهمة
${taskDescription}

## الحالة الحالية
URL: ${currentUrl}
محتوى الصفحة (أول 1200 حرف):
${pageContent.substring(0, 1200)}

## قائمة التحقق
${checklist.items.map((i, n) => `[${n + 1}] ${i.criterion}: يجب أن يُرى → "${i.mustBeVisible}"`).join("\n")}

## القاعدة الصارمة
"مرئي" = النص موجود حرفياً في محتوى الصفحة أعلاه.
إذا لم تجده → لم يتحقق.

أجب بـ JSON فقط:
{
  "completed": true/false,
  "evidence": "الدليل الحرفي المرئي أو سبب عدم الاكتمال",
  "missingItems": ["ما لم يتحقق"],
  "nextAction": "الخطوة التالية"
}`;
}
