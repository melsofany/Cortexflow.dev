import axios from "axios";
import { classifyWithDeepSeek } from "./deepseekClassifier.js";

export type TaskCategory =
  | "browser"     // تصفح الويب، نماذج، تسجيل
  | "code"        // برمجة، كود، سكريبت
  | "research"    // بحث، تحليل، معلومات
  | "creative"    // كتابة، قصة، محتوى إبداعي
  | "math"        // حسابات، رياضيات
  | "translation" // ترجمة
  | "reasoning"   // تفكير منطقي معقد
  | "file"        // عمليات ملفات
  | "agent"       // مهام متعددة الخطوات
  | "simple";     // مهام قصيرة بسيطة

// ── نظام الذاكرة والتحسين الذاتي ─────────────────────────────────────────────

interface ModelPerformance {
  successes: number;
  failures: number;
  avgDuration: number;
  lastUsed: Date;
  qualityScore: number;
}

class SelfImprovingModelSelector {
  private performanceHistory: Map<string, Map<string, ModelPerformance>> = new Map();
  private taskHistory: Array<{model: string; category: string; success: boolean; duration: number}> = [];

  recordResult(model: string, category: string, success: boolean, duration: number, quality = 0.5) {
    if (!this.performanceHistory.has(model)) {
      this.performanceHistory.set(model, new Map());
    }
    const modelMap = this.performanceHistory.get(model)!;
    const current = modelMap.get(category) || { successes: 0, failures: 0, avgDuration: 0, lastUsed: new Date(), qualityScore: 0.5 };

    if (success) current.successes++;
    else current.failures++;

    const alpha = 0.3;
    current.avgDuration = current.avgDuration * (1 - alpha) + duration * alpha;
    current.qualityScore = current.qualityScore * (1 - alpha) + quality * alpha;
    current.lastUsed = new Date();

    modelMap.set(category, current);

    this.taskHistory.push({ model, category, success, duration });
    if (this.taskHistory.length > 200) {
      this.taskHistory = this.taskHistory.slice(-200);
    }
  }

  getLearnedScore(model: string, category: string): number {
    const perf = this.performanceHistory.get(model)?.get(category);
    if (!perf) return 0.5;
    const total = perf.successes + perf.failures;
    if (total < 2) return 0.5;
    return (perf.successes / total) * 0.7 + perf.qualityScore * 0.3;
  }

  getSelfImprovementReport(): string {
    if (this.taskHistory.length === 0) return "لم يتم تنفيذ مهام بعد.";
    const successes = this.taskHistory.filter(t => t.success).length;
    const rate = Math.round((successes / this.taskHistory.length) * 100);
    return `معدل النجاح: ${rate}% من ${this.taskHistory.length} مهمة`;
  }
}

export const modelSelector = new SelfImprovingModelSelector();

// ── قواميس الكلمات المفتاحية ──────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<TaskCategory, string[]> = {
  browser: [
    "افتح", "تصفح", "انتقل", "موقع", "اذهب", "سجل", "تسجيل", "حساب",
    "facebook", "twitter", "instagram", "youtube", "google", "فيسبوك",
    "تويتر", "انستجرام", "يوتيوب", "جوجل", "ويب", "web", "url", "http",
    "قم بانشاء", "انشئ حساب", "سجل دخول", "اشتر", "اشترك", "احجز",
  ],
  code: [
    "اكتب كود", "برمجة", "كود", "script", "python", "javascript", "برنامج",
    "function", "api", "class", "اكتب برنامج", "طوّر", "أنشئ تطبيق",
    "debug", "خطأ برمجي", "typescript", "sql", "database", "سكريبت",
    "ابرمج", "اكتب دالة", "أصلح الكود",
  ],
  research: [
    "ابحث", "اشرح", "ما هو", "ما هي", "كيف", "لماذا", "متى", "أين",
    "معلومات", "تفاصيل", "تحليل", "قارن", "مقارنة", "دراسة", "بيانات",
    "إحصاء", "تقرير", "ملخص", "explain", "research", "analyze", "summary",
    "وضّح", "عرّف", "فسّر",
  ],
  creative: [
    "اكتب", "قصة", "مقال", "قصيدة", "محتوى", "نص", "وصف", "إعلان",
    "creative", "write", "story", "article", "blog", "post", "منشور",
    "حوار", "سكريبت إبداعي", "أسلوب", "أنشئ محتوى", "خطاب", "رسالة",
  ],
  math: [
    "احسب", "حساب", "معادلة", "رياضيات", "جمع", "طرح", "ضرب", "قسمة",
    "calculate", "math", "equation", "formula", "percentage", "نسبة مئوية",
    "integral", "derivative", "statistics", "إحصاء رياضي", "جذر", "قوة",
    "ناتج", "ضاحيل", "لوغاريتم",
  ],
  translation: [
    "ترجم", "translation", "translate", "بالعربية", "بالإنجليزية",
    "بالفرنسية", "اللغة", "language", "من العربي", "إلى الإنجليزي",
    "ترجمة", "انقل إلى",
  ],
  reasoning: [
    "فكّر", "استنتج", "هل يمكن", "ما الأفضل", "قيّم", "تقييم", "قرار",
    "خطة استراتيجية", "توصية", "نصيحة", "scenario", "افتراضي", "لو",
    "إذا كان", "ماذا سيحدث", "مقارنة معقدة", "تحليل عميق", "منطق",
    "استنتاج", "قارن بين",
  ],
  file: [
    "اقرأ ملف", "اكتب ملف", "احفظ", "قراءة", "كتابة", "ملف", "file",
    "directory", "مجلد", "path", "json", "csv", "txt", "read file",
  ],
  agent: [
    "خطط", "نفّذ سلسلة", "أنجز", "حقق هدف", "وكيل", "agent",
    "متعدد الخطوات", "خطة متكاملة", "مشروع", "سلسلة من الإجراءات",
  ],
  simple: [],
};

// ── ملفات تعريف النماذج ──────────────────────────────────────────────────────

interface ModelProfile {
  name: string;
  strengths: TaskCategory[];
  speed: "fast" | "medium" | "slow";
  size: number;
  baseScores: Partial<Record<TaskCategory, number>>;
}

const MODEL_PROFILES: ModelProfile[] = [
  {
    name: "qwen2:0.5b",
    strengths: ["simple", "translation"],
    speed: "fast", size: 352,
    baseScores: { simple: 0.9, translation: 0.8, code: 0.4, research: 0.4, math: 0.4 },
  },
  {
    name: "qwen2.5:0.5b",
    strengths: ["simple", "translation"],
    speed: "fast", size: 397,
    baseScores: { simple: 0.9, translation: 0.8, code: 0.5, research: 0.4, math: 0.5 },
  },
  {
    name: "llama3.2:1b",
    strengths: ["research", "creative", "reasoning", "code", "browser", "agent"],
    speed: "medium", size: 1300,
    baseScores: { browser: 0.7, code: 0.7, research: 0.7, creative: 0.7, math: 0.6, translation: 0.6, reasoning: 0.7, agent: 0.7 },
  },
  {
    name: "llama3.2:3b",
    strengths: ["research", "creative", "reasoning", "code", "browser", "agent", "math"],
    speed: "medium", size: 2000,
    baseScores: { browser: 0.8, code: 0.8, research: 0.8, creative: 0.8, math: 0.7, translation: 0.7, reasoning: 0.8, agent: 0.8 },
  },
  {
    name: "mistral:7b-instruct-q2_K",
    strengths: ["research", "creative", "reasoning", "code", "translation", "math", "agent"],
    speed: "slow", size: 3000,
    baseScores: { code: 0.9, research: 0.9, reasoning: 0.9, math: 0.9, translation: 0.8, creative: 0.8, agent: 0.9 },
  },
  {
    name: "mistral:latest",
    strengths: ["research", "creative", "reasoning", "code", "translation", "math", "agent"],
    speed: "slow", size: 4100,
    baseScores: { code: 0.9, research: 0.9, reasoning: 0.9, math: 0.9, translation: 0.8, creative: 0.8, agent: 0.9 },
  },
  {
    name: "phi3:mini",
    strengths: ["code", "math", "reasoning"],
    speed: "medium", size: 2300,
    baseScores: { code: 0.8, math: 0.9, reasoning: 0.8, research: 0.8, creative: 0.7 },
  },
  {
    name: "gemma2:2b",
    strengths: ["creative", "research", "reasoning"],
    speed: "medium", size: 1600,
    baseScores: { creative: 0.8, research: 0.8, reasoning: 0.7, code: 0.7, translation: 0.7 },
  },
];

// ── منطق التصنيف والاختيار ─────────────────────────────────────────────────

export function classifyTask(description: string, taskType?: string): TaskCategory {
  if (taskType && taskType !== "general") return taskType as TaskCategory;

  const text = description.toLowerCase();
  const scores: Record<TaskCategory, number> = {
    browser: 0, code: 0, research: 0, creative: 0, math: 0,
    translation: 0, reasoning: 0, file: 0, agent: 0, simple: 0,
  };

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [TaskCategory, string[]][]) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) {
        scores[category] += 1;
      }
    }
  }

  if (description.trim().split(/\s+/).length <= 5) {
    scores.simple += 2;
  }

  const best = (Object.entries(scores) as [TaskCategory, number][])
    .sort((a, b) => b[1] - a[1])[0];

  return best[1] > 0 ? best[0] : "simple";
}


export async function selectBestModel(
  description: string,
  taskType?: string,
  availableModels?: string[]
): Promise<{ model: string; category: TaskCategory; reason: string; classifier?: string }> {

  // ── تصنيف المهمة: DeepSeek أولاً، ثم Keywords كبديل ─────────────────────
  let category: TaskCategory;
  let classifierSource = "keywords";

  const forcedTypes = ["browser", "system", "research", "ai"];
  if (taskType && !forcedTypes.includes(taskType)) {
    category = taskType as TaskCategory;
    classifierSource = "forced";
  } else if (taskType === "browser") {
    category = "browser";
    classifierSource = "forced";
  } else {
    const dsResult = await classifyWithDeepSeek(description);
    if (dsResult.source === "deepseek" && dsResult.confidence === "high") {
      category = dsResult.category;
      classifierSource = "deepseek";
    } else {
      category = classifyTask(description, taskType);
      classifierSource = "keywords";
    }
  }

  if (!availableModels) {
    try {
      const res = await axios.get("http://localhost:11434/api/tags", { timeout: 3000 });
      availableModels = (res.data?.models || []).map((m: any) => m.name as string);
    } catch {
      availableModels = [];
    }
  }

  if (availableModels.length === 0) {
    return { model: "qwen2:0.5b", category, reason: "لا يوجد نماذج مثبتة — تحقق من Ollama" };
  }

  const installedProfiles = MODEL_PROFILES.filter(p => availableModels!.includes(p.name));

  // إذا لم يكن أي نموذج معروف، استخدم الأول المتاح
  if (installedProfiles.length === 0) {
    return { model: availableModels[0], category, reason: "استخدام أول نموذج متاح" };
  }

  // حساب نقطة مركبة: أساسية + مكتسبة
  const scored = installedProfiles.map(p => {
    const baseScore = p.baseScores[category] ?? 0.5;
    const learnedScore = modelSelector.getLearnedScore(p.name, category);
    const combined = baseScore * 0.6 + learnedScore * 0.4;

    // تفضيل النماذج الأسرع للمهام البسيطة
    let speedBonus = 0;
    if (category === "simple" || category === "browser") {
      speedBonus = p.speed === "fast" ? 0.1 : p.speed === "medium" ? 0.05 : 0;
    } else {
      // تفضيل النماذج الأكبر للمهام المعقدة
      speedBonus = p.speed === "slow" ? 0.05 : 0;
    }

    return { profile: p, score: combined + speedBonus };
  });

  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0].profile;

  const reasonMap: Record<TaskCategory, string> = {
    browser:     "مهمة تصفح ويب — نموذج سريع ومتفاعل",
    code:        "مهمة برمجية — نموذج متخصص في الكود",
    research:    "مهمة بحثية — نموذج ذو قدرة تحليلية عالية",
    creative:    "مهمة إبداعية — نموذج ذو قدرة توليدية قوية",
    math:        "مهمة رياضية — نموذج ذو دقة عددية عالية",
    translation: "مهمة ترجمة — نموذج متعدد اللغات",
    reasoning:   "تفكير معقد — أقوى نموذج متاح",
    file:        "عمليات ملفات — نموذج يدعم البيانات",
    agent:       "مهمة متعددة الخطوات — نموذج تخطيطي قوي",
    simple:      "مهمة بسيطة — نموذج سريع وكافٍ",
  };

  const classifierLabel = classifierSource === "deepseek"
    ? "🤖 DeepSeek"
    : classifierSource === "forced"
    ? "🎯 مباشر"
    : "🔑 كلمات مفتاحية";

  return {
    model: winner.name,
    category,
    classifier: classifierSource,
    reason: `${reasonMap[category]} | تصنيف بـ ${classifierLabel} | نقطة: ${scored[0].score.toFixed(2)} | ${modelSelector.getSelfImprovementReport()}`,
  };
}

export function formatModelSelection(model: string, category: TaskCategory, reason: string): string {
  const categoryAr: Record<TaskCategory, string> = {
    browser:     "🌐 تصفح ويب",
    code:        "💻 برمجة",
    research:    "🔍 بحث وتحليل",
    creative:    "✍️ إبداعية",
    math:        "🔢 رياضيات",
    translation: "🌍 ترجمة",
    reasoning:   "🧠 تفكير معقد",
    file:        "📁 ملفات",
    agent:       "🤖 وكيل متعدد الخطوات",
    simple:      "⚡ سريعة",
  };
  return `تصنيف المهمة: ${categoryAr[category]}\nالنموذج المختار: ${model}\nالسبب: ${reason}`;
}
