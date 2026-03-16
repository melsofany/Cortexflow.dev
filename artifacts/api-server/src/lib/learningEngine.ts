import fs from "fs";
import path from "path";

const DATA_DIR  = path.resolve(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "learning.json");

export interface LearnedUrl {
  keyword: string;
  url: string;
  count: number;
  lastUsed: string;
}

export interface LearnedStrategy {
  taskPattern: string;
  steps: string[];
  successCount: number;
  failCount: number;
  lastUsed: string;
  tags: string[];
}

export interface LearnedPreference {
  key: string;
  value: string;
  updatedAt: string;
}

export interface LearningData {
  urls: LearnedUrl[];
  strategies: LearnedStrategy[];
  preferences: LearnedPreference[];
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  createdAt: string;
  updatedAt: string;
}

class LearningEngine {
  private data: LearningData;

  constructor() {
    this.data = this.load();
  }

  private load(): LearningData {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, "utf-8");
        return JSON.parse(raw) as LearningData;
      }
    } catch {}
    return {
      urls: [],
      strategies: [],
      preferences: [],
      totalTasks: 0,
      successfulTasks: 0,
      failedTasks: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  private save(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      this.data.updatedAt = new Date().toISOString();
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (e: any) {
      console.error("[Learning] Failed to save:", e.message);
    }
  }

  learnUrlMapping(keyword: string, url: string): void {
    if (!keyword || !url || keyword.length < 3 || url.length < 5) return;
    const k = keyword.toLowerCase().trim();
    const existing = this.data.urls.find(u => u.keyword === k);
    if (existing) {
      existing.url = url;
      existing.count++;
      existing.lastUsed = new Date().toISOString();
    } else {
      this.data.urls.push({ keyword: k, url, count: 1, lastUsed: new Date().toISOString() });
      console.log(`[Learning] ✓ تعلّمت ربط جديد: "${keyword}" → ${url}`);
    }
    if (this.data.urls.length > 500) {
      this.data.urls = this.data.urls.sort((a, b) => b.count - a.count).slice(0, 500);
    }
    this.save();
  }

  getLearnedUrl(text: string): string | null {
    const lower = text.toLowerCase();
    const sorted = [...this.data.urls].sort((a, b) => b.keyword.length - a.keyword.length);
    for (const entry of sorted) {
      if (lower.includes(entry.keyword)) {
        entry.count++;
        entry.lastUsed = new Date().toISOString();
        return entry.url;
      }
    }
    return null;
  }

  learnStrategy(taskDesc: string, steps: string[], success: boolean): void {
    if (!taskDesc || steps.length === 0) return;
    const pattern = this.normalizePattern(taskDesc);
    const tags = this.extractTags(taskDesc);
    const existing = this.data.strategies.find(s => s.taskPattern === pattern);
    if (existing) {
      if (success) {
        existing.steps = steps;
        existing.successCount++;
      } else {
        existing.failCount++;
      }
      existing.lastUsed = new Date().toISOString();
    } else if (success) {
      this.data.strategies.push({
        taskPattern: pattern,
        steps,
        successCount: 1,
        failCount: 0,
        lastUsed: new Date().toISOString(),
        tags,
      });
      console.log(`[Learning] ✓ تعلّمت استراتيجية جديدة: "${pattern.substring(0, 50)}"`);
    }
    if (this.data.strategies.length > 200) {
      this.data.strategies = this.data.strategies
        .sort((a, b) => b.successCount - a.successCount)
        .slice(0, 200);
    }
    this.save();
  }

  getRelevantStrategy(taskDesc: string): LearnedStrategy | null {
    const tags = this.extractTags(taskDesc);
    const lower = taskDesc.toLowerCase();
    const candidates = this.data.strategies
      .filter(s => s.successCount > s.failCount)
      .map(s => ({
        s,
        score: s.tags.filter(t => tags.includes(t)).length
          + (lower.includes(s.taskPattern.substring(0, 20)) ? 2 : 0),
      }))
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.s ?? null;
  }

  learnUserPreference(key: string, value: string): void {
    if (!key || !value) return;
    const existing = this.data.preferences.find(p => p.key === key);
    if (existing) {
      existing.value = value;
      existing.updatedAt = new Date().toISOString();
    } else {
      this.data.preferences.push({ key, value, updatedAt: new Date().toISOString() });
      console.log(`[Learning] ✓ تعلّمت تفضيل المستخدم: "${key}" = "${value.substring(0, 30)}"`);
    }
    this.save();
  }

  getUserPreference(key: string): string | null {
    return this.data.preferences.find(p => p.key === key)?.value ?? null;
  }

  recordTaskOutcome(success: boolean): void {
    this.data.totalTasks++;
    if (success) this.data.successfulTasks++;
    else this.data.failedTasks++;
    this.save();
  }

  extractSiteNameFromTask(taskDesc: string): string[] {
    const lower = taskDesc.toLowerCase();
    const patterns = [
      { re: /موقع\s+([\u0600-\u06FF\w\s]{2,20})/g, group: 1 },
      { re: /لموقع\s+([\u0600-\u06FF\w\s]{2,20})/g, group: 1 },
      { re: /(?:open|visit|go to|افتح|اذهب إلى|انتقل إلى)\s+([\w\u0600-\u06FF][\w\u0600-\u06FF\s.-]{1,30})/gi, group: 1 },
    ];
    const found: string[] = [];
    for (const { re, group } of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(lower)) !== null) {
        const name = m[group]?.trim();
        if (name && name.length >= 2) found.push(name);
      }
    }
    return [...new Set(found)];
  }

  learnFromSuccessfulNavigation(taskDesc: string, finalUrl: string): void {
    if (!finalUrl || finalUrl === "about:blank" || !finalUrl.startsWith("http")) return;
    const names = this.extractSiteNameFromTask(taskDesc);
    for (const name of names) {
      try {
        const origin = new URL(finalUrl).origin;
        this.learnUrlMapping(name, origin);
      } catch {}
    }
    const urlWords = finalUrl.replace(/https?:\/\//, "").replace(/\//g, " ").toLowerCase().split(/[\s.-]+/).filter(w => w.length > 3);
    for (const word of urlWords.slice(0, 2)) {
      if (!["www", "com", "org", "net", "html"].includes(word)) {
        this.learnUrlMapping(word, finalUrl.split("/").slice(0, 3).join("/"));
      }
    }
  }

  buildContextHint(taskDesc: string): string {
    const hints: string[] = [];
    const strategy = this.getRelevantStrategy(taskDesc);
    if (strategy && strategy.successCount > 0) {
      // فلترة الخطوات المضللة (التنقل لمواقع خاطئة)
      const filteredSteps = strategy.steps
        .slice(0, 3)
        .filter(s => {
          const lower = s.toLowerCase();
          // استبعد خطوات التنقل لمواقع عامة قد تكون خاطئة
          if (lower.includes("web.whatsapp.com") || lower.includes("whatsapp.com/")) return false;
          if (lower.includes("facebook.com") && !lower.includes("developers.facebook.com")) return false;
          return true;
        });
      if (filteredSteps.length > 0) {
        hints.push(`💡 استراتيجية مشابهة:\n${filteredSteps.map(s => `  - ${s}`).join("\n")}`);
      }
    }
    return hints.join("\n");
  }

  getStats() {
    const successRate = this.data.totalTasks > 0
      ? Math.round((this.data.successfulTasks / this.data.totalTasks) * 100)
      : 0;
    return {
      totalTasks: this.data.totalTasks,
      successfulTasks: this.data.successfulTasks,
      failedTasks: this.data.failedTasks,
      successRate: `${successRate}%`,
      learnedUrls: this.data.urls.length,
      learnedStrategies: this.data.strategies.length,
      learnedPreferences: this.data.preferences.length,
      lastUpdated: this.data.updatedAt,
    };
  }

  getAllData(): LearningData {
    return this.data;
  }

  resetLearning(): void {
    this.data = {
      urls: [],
      strategies: [],
      preferences: [],
      totalTasks: 0,
      successfulTasks: 0,
      failedTasks: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.save();
    console.log("[Learning] تم إعادة ضبط الذاكرة المتعلَّمة.");
  }

  private normalizePattern(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\u0600-\u06FFa-z0-9\s]/g, "")
      .trim()
      .substring(0, 80);
  }

  private extractTags(text: string): string[] {
    const lower = text.toLowerCase();
    const kws = [
      "يوتيوب","youtube","فيسبوك","facebook","واتساب","whatsapp","ميتا","meta",
      "جوجل","google","جيتهاب","github","تويتر","twitter","انستجرام","instagram",
      "تسجيل","login","دخول","حساب","account","كود","code","برمجة","بحث","search",
      "api","تطبيق","app","متصفح","browser","إنشاء","create","ترجمة","translate",
      "ملف","file","تنزيل","download","مطورين","developers","أعمال","business",
    ];
    return kws.filter(k => lower.includes(k));
  }
}

export const learningEngine = new LearningEngine();
