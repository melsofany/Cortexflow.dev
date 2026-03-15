import axios from "axios";

export type TaskCategory =
  | "browser"     // تصفح الويب، نماذج، تسجيل
  | "code"        // برمجة، كود، سكريبت
  | "research"    // بحث، تحليل، معلومات
  | "creative"    // كتابة، قصة، محتوى إبداعي
  | "math"        // حسابات، رياضيات
  | "translation" // ترجمة
  | "reasoning"   // تفكير منطقي معقد
  | "simple";     // مهام قصيرة بسيطة

// ── Keyword maps for task classification ─────────────────────────────────────

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
  ],
  research: [
    "ابحث", "اشرح", "ما هو", "ما هي", "كيف", "لماذا", "متى", "أين",
    "معلومات", "تفاصيل", "تحليل", "قارن", "مقارنة", "دراسة", "بيانات",
    "إحصاء", "تقرير", "ملخص", "explain", "research", "analyze", "summary",
  ],
  creative: [
    "اكتب", "قصة", "مقال", "قصيدة", "محتوى", "نص", "وصف", "إعلان",
    "creative", "write", "story", "article", "blog", "post", "منشور",
    "حوار", "سكريبت إبداعي", "أسلوب", "أنشئ محتوى",
  ],
  math: [
    "احسب", "حساب", "معادلة", "رياضيات", "جمع", "طرح", "ضرب", "قسمة",
    "calculate", "math", "equation", "formula", "percentage", "نسبة مئوية",
    "integral", "derivative", "statistics", "إحصاء رياضي",
  ],
  translation: [
    "ترجم", "translation", "translate", "بالعربية", "بالإنجليزية",
    "بالفرنسية", "اللغة", "language", "من العربي", "إلى الإنجليزي",
  ],
  reasoning: [
    "فكّر", "استنتج", "هل يمكن", "ما الأفضل", "قيّم", "تقييم", "قرار",
    "خطة استراتيجية", "توصية", "نصيحة", "scenario", "افتراضي", "لو",
    "إذا كان", "ماذا سيحدث", "مقارنة معقدة", "تحليل عميق",
  ],
  simple: [], // default fallback
};

// ── Model profiles ─────────────────────────────────────────────────────────

interface ModelProfile {
  name: string;
  strengths: TaskCategory[];
  speed: "fast" | "medium" | "slow";
  size: number; // MB approx
}

const MODEL_PROFILES: ModelProfile[] = [
  {
    name: "qwen2:0.5b",
    strengths: ["simple", "translation", "browser"],
    speed: "fast",
    size: 352,
  },
  {
    name: "qwen2.5:0.5b",
    strengths: ["simple", "translation", "browser", "code"],
    speed: "fast",
    size: 397,
  },
  {
    name: "llama3.2:1b",
    strengths: ["research", "creative", "reasoning", "math", "code", "browser"],
    speed: "medium",
    size: 1300,
  },
  {
    name: "llama3.2:3b",
    strengths: ["research", "creative", "reasoning", "math", "code"],
    speed: "medium",
    size: 2000,
  },
  {
    name: "mistral:7b-instruct-q2_K",
    strengths: ["research", "creative", "reasoning", "math", "code", "translation"],
    speed: "slow",
    size: 3000,
  },
  {
    name: "mistral:latest",
    strengths: ["research", "creative", "reasoning", "math", "code", "translation"],
    speed: "slow",
    size: 4100,
  },
];

// ── Core selection logic ───────────────────────────────────────────────────

export function classifyTask(description: string, taskType?: string): TaskCategory {
  if (taskType === "browser") return "browser";

  const text = description.toLowerCase();
  const scores: Record<TaskCategory, number> = {
    browser: 0, code: 0, research: 0, creative: 0,
    math: 0, translation: 0, reasoning: 0, simple: 0,
  };

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [TaskCategory, string[]][]) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) {
        scores[category] += 1;
      }
    }
  }

  // Bias toward simple if the task is very short
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
): Promise<{ model: string; category: TaskCategory; reason: string }> {
  const category = classifyTask(description, taskType);

  // Get available models if not provided
  if (!availableModels) {
    try {
      const res = await axios.get("http://localhost:11434/api/tags", { timeout: 3000 });
      availableModels = (res.data?.models || []).map((m: any) => m.name as string);
    } catch {
      availableModels = [];
    }
  }

  if (availableModels.length === 0) {
    return { model: "qwen2:0.5b", category, reason: "لا يوجد نماذج مثبتة — استخدام الافتراضي" };
  }

  // Find the best profile that matches category AND is installed
  const installedProfiles = MODEL_PROFILES.filter(p => availableModels!.includes(p.name));

  if (installedProfiles.length === 0) {
    return { model: availableModels[0], category, reason: "استخدام أول نموذج متاح" };
  }

  // Score each installed model: +3 if category in strengths, +1 per strength match
  const scored = installedProfiles.map(p => {
    let score = 0;
    if (p.strengths.includes(category)) score += 3;
    // For simple tasks, prefer faster models
    if (category === "simple" || category === "browser") {
      if (p.speed === "fast") score += 2;
      else if (p.speed === "medium") score += 1;
    } else {
      // For complex tasks, prefer larger models
      if (p.speed === "slow") score += 1;
      else if (p.speed === "medium") score += 0.5;
    }
    return { profile: p, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0].profile;

  const reasonMap: Record<TaskCategory, string> = {
    browser:     "مهمة تصفح ويب — نموذج سريع للتنقل والتفاعل",
    code:        "مهمة برمجية — نموذج متخصص في الكود",
    research:    "مهمة بحثية — نموذج ذو قدرة تحليلية عالية",
    creative:    "مهمة إبداعية — نموذج ذو قدرة توليدية قوية",
    math:        "مهمة رياضية — نموذج ذو منطق عددي دقيق",
    translation: "مهمة ترجمة — نموذج متعدد اللغات",
    reasoning:   "مهمة تفكير معقدة — أقوى نموذج متاح",
    simple:      "مهمة بسيطة — نموذج سريع وكافٍ",
  };

  return {
    model: winner.name,
    category,
    reason: reasonMap[category],
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
    simple:      "⚡ سريعة",
  };
  return `تصنيف المهمة: ${categoryAr[category]}\nالنموذج المختار: ${model}\nالسبب: ${reason}`;
}
