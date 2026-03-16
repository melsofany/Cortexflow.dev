import fs from "fs";
import path from "path";
import axios from "axios";

const DATA_DIR = path.resolve(process.cwd(), "data");
const TECH_FILE = path.join(DATA_DIR, "tech_knowledge.json");
const IMPROVEMENTS_FILE = path.join(DATA_DIR, "code_improvements.json");
const METRICS_FILE = path.join(DATA_DIR, "performance_metrics.json");

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";
const AGENT_SERVICE = process.env.AGENT_SERVICE_URL || "http://localhost:8090";

const getDeepSeekKey = () => process.env.DEEPSEEK_API_KEY || "";

// ══════════════════════════════════════════════════════════════
//  أنواع البيانات
// ══════════════════════════════════════════════════════════════

export interface TechEntry {
  topic: string;
  summary: string;
  keyItems: string[];
  source: string;
  relevance: "critical" | "high" | "medium" | "low";
  updatedAt: string;
}

export interface TechKnowledge {
  entries: TechEntry[];
  lastResearch: string;
  researchCount: number;
  contextSummary: string;
}

export interface CodeImprovement {
  id: string;
  file: string;
  category: "performance" | "security" | "modernization" | "best-practice" | "bug-fix";
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  currentCode: string;
  suggestedCode: string;
  reason: string;
  status: "pending" | "applied" | "rejected";
  createdAt: string;
  appliedAt?: string;
}

export interface CodeImprovements {
  improvements: CodeImprovement[];
  lastAnalysis: string;
  totalApplied: number;
}

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: string;
  status: "healthy" | "warning" | "critical";
}

export interface PerformanceSnapshot {
  timestamp: string;
  metrics: PerformanceMetric[];
  issues: string[];
  score: number;
}

export interface PerformanceData {
  snapshots: PerformanceSnapshot[];
  taskStats: { total: number; success: number; failed: number; avgDurationMs: number };
  apiHealth: { deepseek: boolean; ollama: boolean; browser: boolean; agentService: boolean };
  lastCheck: string;
  alerts: Array<{ level: "warn" | "critical"; message: string; timestamp: string }>;
}

// ══════════════════════════════════════════════════════════════
//  مساعدات
// ══════════════════════════════════════════════════════════════

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {}
  return fallback;
}

function writeJson(file: string, data: unknown) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

async function callDeepSeek(systemPrompt: string, userPrompt: string, maxTokens = 1500): Promise<string> {
  const key = getDeepSeekKey();
  if (!key) return "";
  try {
    const res = await axios.post(
      DEEPSEEK_URL,
      {
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.3,
      },
      { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, timeout: 45000 }
    );
    return res.data?.choices?.[0]?.message?.content || "";
  } catch (e: any) {
    console.error("[TechIntelligence] DeepSeek error:", e.message);
    return "";
  }
}

async function webSearch(query: string): Promise<string> {
  try {
    const res = await axios.post(
      `${AGENT_SERVICE}/run`,
      { task: `ابحث عن: ${query}`, category: "research" },
      { timeout: 20000 }
    );
    return res.data?.result || "";
  } catch {
    return "";
  }
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// ══════════════════════════════════════════════════════════════
//  1. وحدة البحث التقني
// ══════════════════════════════════════════════════════════════

class TechResearcher {
  private data: TechKnowledge;

  constructor() {
    this.data = readJson<TechKnowledge>(TECH_FILE, {
      entries: [],
      lastResearch: "",
      researchCount: 0,
      contextSummary: "",
    });
  }

  private save() { writeJson(TECH_FILE, this.data); }

  async research(): Promise<void> {
    console.log("[TechIntelligence] 🔍 بدء بحث التقنيات...");

    const topics = [
      { topic: "أحدث مكتبات الذكاء الاصطناعي Python 2024-2025", key: "ai-python" },
      { topic: "أحدث إصدارات LangChain LangGraph AutoGen CrewAI", key: "agent-frameworks" },
      { topic: "أحدث تقنيات Playwright browser automation 2025", key: "browser-automation" },
      { topic: "أفضل ممارسات Node.js TypeScript Express Socket.io 2025", key: "nodejs-best" },
      { topic: "أحدث نماذج DeepSeek Ollama AI 2025", key: "ai-models" },
      { topic: "أفضل ممارسات تطوير وكلاء AI agents architecture", key: "agent-arch" },
    ];

    for (const { topic, key } of topics) {
      try {
        const searchResult = await webSearch(topic);

        const analyzed = await callDeepSeek(
          `أنت خبير تقني. تحلل نتائج البحث وتستخرج المعلومات الأكثر أهمية وتطبيقية لمشروع CortexFlow الذي يستخدم: TypeScript, Node.js, Python, FastAPI, LangGraph, Playwright, DeepSeek API, Socket.io.`,
          `البحث عن: "${topic}"
نتيجة البحث:
${searchResult.substring(0, 2000)}

استخرج:
1. أهم 3-5 نقاط تقنية محددة
2. أحدث المكتبات/الأدوات المذكورة مع إصداراتها
3. مدى الأهمية للمشروع (critical/high/medium/low)
4. توصيات تطبيقية قصيرة

أجب بـ JSON فقط:
{"keyItems":["..."],"summary":"...","relevance":"high","recommendations":"..."}`
        );

        let parsed: any = {};
        try {
          const match = analyzed.match(/\{[\s\S]*\}/);
          if (match) parsed = JSON.parse(match[0]);
        } catch {}

        const entry: TechEntry = {
          topic,
          summary: parsed.summary || `بحث حول: ${topic}`,
          keyItems: Array.isArray(parsed.keyItems) ? parsed.keyItems : [],
          source: key,
          relevance: parsed.relevance || "medium",
          updatedAt: new Date().toISOString(),
        };

        const existing = this.data.entries.findIndex(e => e.source === key);
        if (existing >= 0) this.data.entries[existing] = entry;
        else this.data.entries.push(entry);

        console.log(`[TechIntelligence] ✓ تعلّم: ${topic.substring(0, 50)}`);
        await new Promise(r => setTimeout(r, 1000));
      } catch (e: any) {
        console.warn(`[TechIntelligence] فشل بحث "${topic}": ${e.message}`);
      }
    }

    this.data.researchCount++;
    this.data.lastResearch = new Date().toISOString();
    this.data.contextSummary = await this.buildSummary();
    this.save();
    console.log("[TechIntelligence] ✅ اكتمل البحث التقني");
  }

  private async buildSummary(): Promise<string> {
    const allItems = this.data.entries
      .filter(e => e.relevance === "critical" || e.relevance === "high")
      .flatMap(e => e.keyItems)
      .slice(0, 20);

    if (allItems.length === 0) return "";

    const summary = await callDeepSeek(
      "أنت خبير تقني. لخّص أهم التقنيات التي يجب استخدامها في مشروع ذكاء اصطناعي.",
      `لخّص هذه النقاط التقنية في جملتين أو ثلاث تُستخدم كسياق للوكيل:\n${allItems.join("\n")}`,
      300
    );
    return summary;
  }

  getContext(): string {
    if (!this.data.entries.length) return "";
    const top = this.data.entries
      .filter(e => e.relevance === "critical" || e.relevance === "high")
      .slice(0, 3);
    if (top.length === 0) return "";
    const lines = top.flatMap(e => e.keyItems.slice(0, 2)).join("، ");
    return `\n📚 أحدث التقنيات المعروفة: ${lines}`;
  }

  getData(): TechKnowledge { return this.data; }

  shouldResearch(): boolean {
    if (!this.data.lastResearch) return true;
    const sixHours = 6 * 60 * 60 * 1000;
    return Date.now() - new Date(this.data.lastResearch).getTime() > sixHours;
  }
}

// ══════════════════════════════════════════════════════════════
//  2. وحدة التطوير الذاتي للكود
// ══════════════════════════════════════════════════════════════

const KEY_FILES = [
  { path: "artifacts/api-server/src/lib/agentRunner.ts", label: "Agent Runner" },
  { path: "artifacts/api-server/src/lib/browserAgent.ts", label: "Browser Agent" },
  { path: "artifacts/api-server/src/lib/learningEngine.ts", label: "Learning Engine" },
  { path: "artifacts/api-server/src/lib/modelSelector.ts", label: "Model Selector" },
  { path: "artifacts/agent-service/main.py", label: "Python Agent Service" },
];

class CodeSelfImprover {
  private data: CodeImprovements;

  constructor() {
    this.data = readJson<CodeImprovements>(IMPROVEMENTS_FILE, {
      improvements: [],
      lastAnalysis: "",
      totalApplied: 0,
    });
  }

  private save() { writeJson(IMPROVEMENTS_FILE, this.data); }

  async analyze(techContext: string): Promise<void> {
    console.log("[TechIntelligence] 🔧 تحليل الكود للتحسين...");

    for (const { path: filePath, label } of KEY_FILES) {
      try {
        const fullPath = path.resolve(process.cwd(), filePath);
        if (!fs.existsSync(fullPath)) continue;

        const code = fs.readFileSync(fullPath, "utf-8");
        const snippet = code.length > 3000 ? code.substring(0, 1500) + "\n...[تم الاختصار]...\n" + code.substring(code.length - 500) : code;

        const result = await callDeepSeek(
          `أنت خبير تطوير برمجيات متخصص في TypeScript, Python, AI agents. 
تحلل الكود وتقترح تحسينات مبنية على أحدث التقنيات.
${techContext ? `التقنيات المتاحة: ${techContext}` : ""}

القواعد:
- اقترح تحسينات محددة وقابلة للتطبيق فوراً
- ركّز على: الأداء، الاستقرار، الأمان، أحدث المكتبات
- لا تقترح تغييرات جذرية في البنية
- أجب بـ JSON فقط`,

          `الملف: ${label} (${filePath})
\`\`\`
${snippet}
\`\`\`

اقترح 1-2 تحسين عملي. أجب بـ JSON:
[
  {
    "category": "performance|security|modernization|best-practice|bug-fix",
    "title": "عنوان قصير",
    "description": "وصف ما سيتحسن",
    "priority": "critical|high|medium|low",
    "currentCode": "السطر/الدالة الحالية (مختصرة)",
    "suggestedCode": "الكود المحسّن",
    "reason": "سبب التحسين ومرجعه التقني"
  }
]`,
          1200
        );

        let suggestions: any[] = [];
        try {
          const match = result.match(/\[[\s\S]*\]/);
          if (match) suggestions = JSON.parse(match[0]);
        } catch {}

        for (const s of suggestions) {
          if (!s.title || !s.description) continue;
          const alreadyExists = this.data.improvements.some(
            i => i.file === filePath && i.title === s.title && i.status === "pending"
          );
          if (alreadyExists) continue;

          const improvement: CodeImprovement = {
            id: generateId(),
            file: filePath,
            category: s.category || "best-practice",
            title: s.title,
            description: s.description,
            priority: s.priority || "medium",
            currentCode: s.currentCode || "",
            suggestedCode: s.suggestedCode || "",
            reason: s.reason || "",
            status: "pending",
            createdAt: new Date().toISOString(),
          };

          this.data.improvements.push(improvement);
          console.log(`[TechIntelligence] 💡 تحسين مقترح: [${filePath}] ${s.title}`);
        }

        await new Promise(r => setTimeout(r, 1500));
      } catch (e: any) {
        console.warn(`[TechIntelligence] فشل تحليل ${label}: ${e.message}`);
      }
    }

    this.data.lastAnalysis = new Date().toISOString();
    // الاحتفاظ بآخر 50 تحسين فقط
    if (this.data.improvements.length > 50) {
      this.data.improvements = this.data.improvements
        .sort((a, b) => {
          const prio = { critical: 4, high: 3, medium: 2, low: 1 };
          return (prio[b.priority] || 0) - (prio[a.priority] || 0);
        })
        .slice(0, 50);
    }
    this.save();
    console.log("[TechIntelligence] ✅ اكتمل تحليل الكود");
  }

  applyImprovement(id: string): { success: boolean; message: string } {
    const imp = this.data.improvements.find(i => i.id === id);
    if (!imp) return { success: false, message: "التحسين غير موجود" };
    if (imp.status === "applied") return { success: false, message: "التحسين مطبّق مسبقاً" };
    if (!imp.suggestedCode || imp.suggestedCode.length < 5)
      return { success: false, message: "لا يوجد كود مقترح قابل للتطبيق" };

    try {
      const fullPath = path.resolve(process.cwd(), imp.file);
      if (!fs.existsSync(fullPath))
        return { success: false, message: `الملف غير موجود: ${imp.file}` };

      const content = fs.readFileSync(fullPath, "utf-8");
      if (!imp.currentCode || !content.includes(imp.currentCode.trim())) {
        imp.status = "rejected";
        this.save();
        return { success: false, message: "الكود الحالي المراد استبداله غير موجود في الملف (ربما تغيّر)" };
      }

      const updated = content.replace(imp.currentCode.trim(), imp.suggestedCode.trim());
      fs.writeFileSync(fullPath, updated, "utf-8");

      imp.status = "applied";
      imp.appliedAt = new Date().toISOString();
      this.data.totalApplied++;
      this.save();

      console.log(`[TechIntelligence] ✅ طُبّق التحسين: ${imp.title} في ${imp.file}`);
      return { success: true, message: `تم تطبيق التحسين: ${imp.title}` };
    } catch (e: any) {
      return { success: false, message: `خطأ في التطبيق: ${e.message}` };
    }
  }

  rejectImprovement(id: string): boolean {
    const imp = this.data.improvements.find(i => i.id === id);
    if (!imp) return false;
    imp.status = "rejected";
    this.save();
    return true;
  }

  getData(): CodeImprovements { return this.data; }

  getPending(): CodeImprovement[] {
    return this.data.improvements.filter(i => i.status === "pending");
  }

  shouldAnalyze(): boolean {
    if (!this.data.lastAnalysis) return true;
    const twelveHours = 12 * 60 * 60 * 1000;
    return Date.now() - new Date(this.data.lastAnalysis).getTime() > twelveHours;
  }
}

// ══════════════════════════════════════════════════════════════
//  3. وحدة مراقبة الأداء
// ══════════════════════════════════════════════════════════════

class PerformanceMonitor {
  private data: PerformanceData;
  private taskTimings: Map<string, number> = new Map();

  constructor() {
    this.data = readJson<PerformanceData>(METRICS_FILE, {
      snapshots: [],
      taskStats: { total: 0, success: 0, failed: 0, avgDurationMs: 0 },
      apiHealth: { deepseek: false, ollama: false, browser: false, agentService: false },
      lastCheck: "",
      alerts: [],
    });
  }

  private save() { writeJson(METRICS_FILE, this.data); }

  recordTaskStart(taskId: string) {
    this.taskTimings.set(taskId, Date.now());
  }

  recordTaskEnd(taskId: string, success: boolean) {
    const start = this.taskTimings.get(taskId);
    this.taskTimings.delete(taskId);
    const duration = start ? Date.now() - start : 0;

    this.data.taskStats.total++;
    if (success) this.data.taskStats.success++;
    else this.data.taskStats.failed++;

    const total = this.data.taskStats.total;
    this.data.taskStats.avgDurationMs =
      Math.round((this.data.taskStats.avgDurationMs * (total - 1) + duration) / total);

    if (!success) {
      const rate = Math.round((this.data.taskStats.failed / total) * 100);
      if (rate > 30) this.addAlert("warn", `معدل فشل المهام مرتفع: ${rate}%`);
      if (rate > 60) this.addAlert("critical", `معدل فشل المهام حرج: ${rate}% — يحتاج مراجعة`);
    }

    this.save();
  }

  addAlert(level: "warn" | "critical", message: string) {
    this.data.alerts.unshift({ level, message, timestamp: new Date().toISOString() });
    if (this.data.alerts.length > 50) this.data.alerts = this.data.alerts.slice(0, 50);
    console.log(`[Monitor] ${level === "critical" ? "🔴" : "🟡"} ${message}`);
  }

  setBrowserHealth(ok: boolean) {
    this.data.apiHealth.browser = ok;
  }

  async checkHealth(): Promise<void> {
    const metrics: PerformanceMetric[] = [];
    const issues: string[] = [];

    // فحص DeepSeek
    try {
      if (getDeepSeekKey()) {
        const start = Date.now();
        const res = await axios.post(
          DEEPSEEK_URL,
          { model: DEEPSEEK_MODEL, messages: [{ role: "user", content: "ping" }], max_tokens: 3 },
          { headers: { Authorization: `Bearer ${getDeepSeekKey()}` }, timeout: 8000 }
        );
        const latency = Date.now() - start;
        this.data.apiHealth.deepseek = true;
        metrics.push({ name: "deepseek_latency_ms", value: latency, unit: "ms", timestamp: new Date().toISOString(), status: latency < 3000 ? "healthy" : latency < 8000 ? "warning" : "critical" });
        if (latency > 5000) issues.push(`DeepSeek بطيء: ${latency}ms`);
      }
    } catch {
      this.data.apiHealth.deepseek = false;
      issues.push("DeepSeek API غير متاح");
      this.addAlert("warn", "DeepSeek API غير متاح");
    }

    // فحص Ollama — في بيئة cloud لا يُعدّ غيابه خطأً
    const isCloud = process.env.NODE_ENV === "production" || !!process.env.RENDER;
    try {
      const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";
      await axios.get(`${OLLAMA}/api/tags`, { timeout: 3000 });
      this.data.apiHealth.ollama = true;
      metrics.push({ name: "ollama_status", value: 1, unit: "bool", timestamp: new Date().toISOString(), status: "healthy" });
    } catch {
      this.data.apiHealth.ollama = false;
      if (!isCloud) {
        metrics.push({ name: "ollama_status", value: 0, unit: "bool", timestamp: new Date().toISOString(), status: "warning" });
      }
    }

    // فحص Agent Service — في cloud قد يكون نائماً (Render starter spin-down)
    {
      const agentTimeout = isCloud ? 30000 : 4000;
      const maxRetries = isCloud ? 2 : 1;
      let agentOk = false;
      for (let attempt = 0; attempt < maxRetries && !agentOk; attempt++) {
        try {
          await axios.get(`${AGENT_SERVICE}/health`, { timeout: agentTimeout });
          agentOk = true;
        } catch { /* retry */ }
      }
      this.data.apiHealth.agentService = agentOk;
      if (agentOk) {
        metrics.push({ name: "agent_service_status", value: 1, unit: "bool", timestamp: new Date().toISOString(), status: "healthy" });
      } else {
        metrics.push({ name: "agent_service_status", value: 0, unit: "bool", timestamp: new Date().toISOString(), status: isCloud ? "warning" : "warning" });
        if (!isCloud) issues.push("خدمة الوكيل Python غير متاحة");
      }
    }

    // معدل النجاح
    const { total, success, failed, avgDurationMs } = this.data.taskStats;
    if (total > 0) {
      const rate = Math.round((success / total) * 100);
      metrics.push({
        name: "task_success_rate",
        value: rate,
        unit: "%",
        timestamp: new Date().toISOString(),
        status: rate >= 80 ? "healthy" : rate >= 50 ? "warning" : "critical",
      });
      metrics.push({
        name: "task_avg_duration_ms",
        value: avgDurationMs,
        unit: "ms",
        timestamp: new Date().toISOString(),
        status: avgDurationMs < 15000 ? "healthy" : avgDurationMs < 30000 ? "warning" : "critical",
      });
      if (rate < 50) issues.push(`معدل نجاح المهام منخفض: ${rate}%`);
    }

    // حساب النقاط الكلية
    const healthyCount = metrics.filter(m => m.status === "healthy").length;
    const score = metrics.length ? Math.round((healthyCount / metrics.length) * 100) : 100;

    const snapshot: PerformanceSnapshot = {
      timestamp: new Date().toISOString(),
      metrics,
      issues,
      score,
    };

    this.data.snapshots.unshift(snapshot);
    if (this.data.snapshots.length > 100) this.data.snapshots = this.data.snapshots.slice(0, 100);
    this.data.lastCheck = new Date().toISOString();

    if (!isCloud) {
      if (score < 50) this.addAlert("critical", `نقاط الأداء منخفضة جداً: ${score}/100`);
      else if (score < 75) this.addAlert("warn", `أداء النظام يحتاج متابعة: ${score}/100`);
    } else if (score < 30) {
      const recentAlerts = this.data.alerts.slice(0, 3);
      const alreadyAlerted = recentAlerts.some(a => a.message.includes("نقاط الأداء"));
      if (!alreadyAlerted) this.addAlert("warn", `بعض الخدمات غير متاحة في بيئة Cloud: ${score}/100`);
    }

    this.save();
    console.log(`[Monitor] 📊 فحص الصحة: ${score}/100 | مشاكل: ${issues.length}`);
  }

  async generateReport(techContext: string): Promise<string> {
    const latest = this.data.snapshots[0];
    const { taskStats, apiHealth, alerts } = this.data;

    const reportData = {
      score: latest?.score ?? 100,
      metrics: latest?.metrics ?? [],
      issues: latest?.issues ?? [],
      taskStats,
      apiHealth,
      recentAlerts: alerts.slice(0, 5),
    };

    if (!getDeepSeekKey()) {
      return `📊 تقرير الأداء (${new Date().toLocaleDateString("ar-SA")})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• نقاط الأداء: ${reportData.score}/100
• DeepSeek: ${apiHealth.deepseek ? "✅ متاح" : "❌ غير متاح"}
• Ollama: ${apiHealth.ollama ? "✅ متاح" : "⚠️ غير متاح"}
• خدمة الوكيل: ${apiHealth.agentService ? "✅ متاح" : "⚠️ غير متاح"}
• المهام: ${taskStats.total} إجمالي | ${taskStats.success} نجاح | ${taskStats.failed} فشل
• متوسط الوقت: ${Math.round(taskStats.avgDurationMs / 1000)}ث
• تنبيهات حرجة: ${alerts.filter(a => a.level === "critical").length}`;
    }

    return await callDeepSeek(
      "أنت وكيل مراقبة أداء. تحلل بيانات النظام وتقدم تقريراً موجزاً باللغة العربية مع توصيات عملية.",
      `بيانات الأداء:\n${JSON.stringify(reportData, null, 2)}\n${techContext ? `\nأحدث التقنيات المتاحة:\n${techContext}` : ""}\n\nقدّم تقرير أداء موجز يشمل: الحالة الراهنة، المشاكل المكتشفة، التوصيات الفورية.`,
      800
    );
  }

  getData(): PerformanceData { return this.data; }
  getLatestSnapshot(): PerformanceSnapshot | null { return this.data.snapshots[0] ?? null; }
}

// ══════════════════════════════════════════════════════════════
//  النظام الرئيسي
// ══════════════════════════════════════════════════════════════

class TechIntelligenceSystem {
  public researcher = new TechResearcher();
  public improver   = new CodeSelfImprover();
  public monitor    = new PerformanceMonitor();

  private researchInterval: ReturnType<typeof setInterval> | null = null;
  private monitorInterval:  ReturnType<typeof setInterval> | null = null;
  private improveInterval:  ReturnType<typeof setInterval> | null = null;

  startBackgroundJobs(): void {
    console.log("[TechIntelligence] 🚀 بدء المهام الخلفية...");

    // فحص الصحة كل 5 دقائق
    this.monitorInterval = setInterval(() => {
      this.monitor.checkHealth().catch(console.error);
    }, 5 * 60 * 1000);

    // البحث التقني كل 6 ساعات
    this.researchInterval = setInterval(async () => {
      if (this.researcher.shouldResearch()) {
        await this.researcher.research();
      }
    }, 6 * 60 * 60 * 1000);

    // تحليل الكود كل 12 ساعة
    this.improveInterval = setInterval(async () => {
      if (this.improver.shouldAnalyze()) {
        const ctx = this.researcher.getContext();
        await this.improver.analyze(ctx);
      }
    }, 12 * 60 * 60 * 1000);

    // فحص فوري عند البدء
    this.monitor.checkHealth().catch(console.error);

    // بحث تقني فوري إذا لم يحدث مؤخراً (بعد 60 ثانية)
    setTimeout(async () => {
      if (this.researcher.shouldResearch() && getDeepSeekKey()) {
        await this.researcher.research();
        if (this.improver.shouldAnalyze()) {
          await this.improver.analyze(this.researcher.getContext());
        }
      }
    }, 60 * 1000);

    console.log("[TechIntelligence] ✅ المهام الخلفية تعمل");
  }

  stopBackgroundJobs(): void {
    if (this.monitorInterval) clearInterval(this.monitorInterval);
    if (this.researchInterval) clearInterval(this.researchInterval);
    if (this.improveInterval) clearInterval(this.improveInterval);
  }

  // الحصول على السياق التقني لحقنه في prompts الوكيل
  getTechContextForAgent(): string {
    return this.researcher.getContext();
  }

  // تسجيل بداية/نهاية المهمة
  onTaskStart(taskId: string) { this.monitor.recordTaskStart(taskId); }
  onTaskEnd(taskId: string, success: boolean) { this.monitor.recordTaskEnd(taskId, success); }

  async getFullReport(): Promise<string> {
    return this.monitor.generateReport(this.researcher.getContext());
  }

  // إجبار البحث الفوري
  async forceResearch(): Promise<void> {
    await this.researcher.research();
    if (getDeepSeekKey()) {
      await this.improver.analyze(this.researcher.getContext());
    }
  }
}

export const techIntelligence = new TechIntelligenceSystem();
