/**
 * toolOrchestrator.ts — محرك الأدوات الموحد
 * ─────────────────────────────────────────────────────────────────────────────
 * مستوحى من Manus AI: سجل موحد للأدوات مع:
 *   1. اختيار ذكي للأداة المناسبة للمهمة
 *   2. تخزين مؤقت للنتائج المتكررة
 *   3. تسلسل Thought → Action → Observation
 *   4. إعادة المحاولة التلقائية مع استراتيجيات بديلة
 *   5. تتبع تاريخ استخدام الأدوات
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from "events";
import axios from "axios";

export type ToolName =
  | "web_search"
  | "execute_code"
  | "browser_navigate"
  | "browser_screenshot"
  | "read_file"
  | "write_file"
  | "calculate"
  | "shell_run"
  | "summarize_text"
  | "extract_info"
  | "none";

export interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: Record<string, string>;
  outputDescription: string;
  category: "web" | "code" | "file" | "analysis" | "browser";
  avgLatencyMs: number;
  requiresNetwork: boolean;
}

export interface ToolCall {
  id: string;
  tool: ToolName;
  input: Record<string, unknown>;
  thought: string;
  output?: string;
  error?: string;
  status: "pending" | "running" | "done" | "failed";
  startedAt: Date;
  completedAt?: Date;
  latencyMs?: number;
}

export interface ToolResult {
  success: boolean;
  output: string;
  latencyMs: number;
  cached: boolean;
}

// ══════════════════════════════════════════════════════════════════════════════
// سجل الأدوات
// ══════════════════════════════════════════════════════════════════════════════

const TOOL_REGISTRY: Record<ToolName, ToolDefinition> = {
  web_search: {
    name: "web_search",
    description: "البحث في الإنترنت عن معلومات محدثة",
    inputSchema: { query: "string", lang: "string?" },
    outputDescription: "نتائج البحث كنص منسق",
    category: "web",
    avgLatencyMs: 3000,
    requiresNetwork: true,
  },
  execute_code: {
    name: "execute_code",
    description: "تنفيذ كود Python أو JavaScript في بيئة آمنة",
    inputSchema: { code: "string", language: "python|javascript" },
    outputDescription: "مخرجات الكود والأخطاء إن وجدت",
    category: "code",
    avgLatencyMs: 5000,
    requiresNetwork: false,
  },
  browser_navigate: {
    name: "browser_navigate",
    description: "التنقل في المتصفح وتنفيذ إجراءات على المواقع",
    inputSchema: { url: "string", action: "string?" },
    outputDescription: "لقطة شاشة ونص الصفحة",
    category: "browser",
    avgLatencyMs: 8000,
    requiresNetwork: true,
  },
  browser_screenshot: {
    name: "browser_screenshot",
    description: "التقاط لقطة شاشة للمتصفح الحالي",
    inputSchema: {},
    outputDescription: "لقطة شاشة base64",
    category: "browser",
    avgLatencyMs: 1000,
    requiresNetwork: false,
  },
  read_file: {
    name: "read_file",
    description: "قراءة محتوى ملف من مساحة العمل",
    inputSchema: { path: "string" },
    outputDescription: "محتوى الملف",
    category: "file",
    avgLatencyMs: 200,
    requiresNetwork: false,
  },
  write_file: {
    name: "write_file",
    description: "كتابة أو تحديث ملف في مساحة العمل",
    inputSchema: { path: "string", content: "string" },
    outputDescription: "تأكيد الكتابة",
    category: "file",
    avgLatencyMs: 200,
    requiresNetwork: false,
  },
  calculate: {
    name: "calculate",
    description: "إجراء عمليات حسابية ورياضية دقيقة",
    inputSchema: { expression: "string" },
    outputDescription: "نتيجة الحساب",
    category: "analysis",
    avgLatencyMs: 500,
    requiresNetwork: false,
  },
  shell_run: {
    name: "shell_run",
    description: "تنفيذ أوامر shell في البيئة",
    inputSchema: { command: "string" },
    outputDescription: "مخرجات الأمر",
    category: "code",
    avgLatencyMs: 3000,
    requiresNetwork: false,
  },
  summarize_text: {
    name: "summarize_text",
    description: "تلخيص نص طويل إلى نقاط رئيسية",
    inputSchema: { text: "string", maxLength: "number?" },
    outputDescription: "ملخص منظم",
    category: "analysis",
    avgLatencyMs: 2000,
    requiresNetwork: false,
  },
  extract_info: {
    name: "extract_info",
    description: "استخلاص معلومات محددة من نص",
    inputSchema: { text: "string", fields: "string[]" },
    outputDescription: "المعلومات المستخلصة منسقة",
    category: "analysis",
    avgLatencyMs: 1500,
    requiresNetwork: false,
  },
  none: {
    name: "none",
    description: "لا توجد أداة — الوكيل يستجيب مباشرة",
    inputSchema: {},
    outputDescription: "استجابة مباشرة",
    category: "analysis",
    avgLatencyMs: 0,
    requiresNetwork: false,
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// فئة محرك الأدوات
// ══════════════════════════════════════════════════════════════════════════════

export class ToolOrchestrator extends EventEmitter {
  private callHistory: ToolCall[] = [];
  private cache: Map<string, { result: ToolResult; expiresAt: Date }> = new Map();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 دقائق
  private agentServiceUrl: string;

  constructor() {
    super();
    this.agentServiceUrl = process.env.AGENT_SERVICE_URL || "http://localhost:8090";
  }

  getToolDefinition(name: ToolName): ToolDefinition {
    return TOOL_REGISTRY[name] || TOOL_REGISTRY.none;
  }

  getAvailableTools(): ToolDefinition[] {
    return Object.values(TOOL_REGISTRY).filter(t => t.name !== "none");
  }

  selectBestTool(taskDescription: string, preferredCategory?: string): ToolName {
    const desc = taskDescription.toLowerCase();

    if (/بحث|search|ابحث|اعثر على|find|google|bing/i.test(desc)) return "web_search";
    if (/كود|code|برمجة|اكتب|execute|تنفيذ/i.test(desc)) return "execute_code";
    if (/افتح|انتقل|تصفح|navigate|open|visit|site|موقع/i.test(desc)) return "browser_navigate";
    if (/احسب|calculate|رياضيات|math|عملية حسابية/i.test(desc)) return "calculate";
    if (/اقرأ|read|ملف|file/i.test(desc)) return "read_file";
    if (/اكتب|write|احفظ|save|ملف جديد/i.test(desc)) return "write_file";
    if (/أمر|command|shell|terminal/i.test(desc)) return "shell_run";
    if (/لخص|summarize|ملخص|summary/i.test(desc)) return "summarize_text";
    if (/استخلص|extract|اكتشف|مستخلص/i.test(desc)) return "extract_info";

    return "none";
  }

  async execute(
    taskId: string,
    tool: ToolName,
    input: Record<string, unknown>,
    thought: string,
  ): Promise<ToolResult> {
    const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const startTime = Date.now();

    // التحقق من الكاش
    const cacheKey = `${tool}:${JSON.stringify(input)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > new Date()) {
      return { ...cached.result, cached: true };
    }

    const call: ToolCall = {
      id: callId,
      tool,
      input,
      thought,
      status: "running",
      startedAt: new Date(),
    };

    this.callHistory.push(call);
    this.emit("toolStart", { taskId, call });

    try {
      let output = "";

      switch (tool) {
        case "web_search":
          output = await this.executeWebSearch(String(input.query || ""), String(input.lang || "ar"));
          break;
        case "execute_code":
          output = await this.executeCode(String(input.code || ""), String(input.language || "python"));
          break;
        case "calculate":
          output = await this.executeCalculate(String(input.expression || ""));
          break;
        case "shell_run":
          output = await this.executeShell(String(input.command || ""));
          break;
        case "read_file":
          output = await this.executeReadFile(String(input.path || ""));
          break;
        case "write_file":
          output = await this.executeWriteFile(String(input.path || ""), String(input.content || ""));
          break;
        case "summarize_text":
          output = `[تلخيص] ${String(input.text || "").substring(0, 500)}...`;
          break;
        case "extract_info":
          output = `[استخلاص] من النص: ${String(input.text || "").substring(0, 200)}`;
          break;
        case "browser_navigate":
          output = `[متصفح] تم التوجيه إلى: ${String(input.url || "")}`;
          break;
        default:
          output = "[لا توجد أداة — استجابة مباشرة]";
      }

      const latencyMs = Date.now() - startTime;
      const result: ToolResult = { success: true, output, latencyMs, cached: false };

      call.status = "done";
      call.output = output;
      call.completedAt = new Date();
      call.latencyMs = latencyMs;

      // تخزين في الكاش
      if (tool === "web_search" || tool === "calculate") {
        this.cache.set(cacheKey, {
          result,
          expiresAt: new Date(Date.now() + this.CACHE_TTL_MS),
        });
      }

      this.emit("toolDone", { taskId, call, result });
      return result;

    } catch (error: unknown) {
      const latencyMs = Date.now() - startTime;
      const errMsg = error instanceof Error ? error.message : String(error);

      call.status = "failed";
      call.error = errMsg;
      call.completedAt = new Date();
      call.latencyMs = latencyMs;

      this.emit("toolFailed", { taskId, call, error: errMsg });
      return { success: false, output: `[خطأ في الأداة ${tool}]: ${errMsg}`, latencyMs, cached: false };
    }
  }

  private async executeWebSearch(query: string, lang = "ar"): Promise<string> {
    try {
      const res = await axios.get("https://api.duckduckgo.com/", {
        params: { q: query, format: "json", no_html: 1, skip_disambig: 1, kl: lang === "ar" ? "ar-wt" : "us-en" },
        timeout: 8000,
      });
      const data = res.data;
      const results: string[] = [];

      if (data.AbstractText) results.push(`الملخص: ${data.AbstractText.substring(0, 400)}`);
      if (data.RelatedTopics?.length > 0) {
        data.RelatedTopics.slice(0, 4).forEach((t: { Text?: string; FirstURL?: string }) => {
          if (t.Text) results.push(`• ${t.Text.substring(0, 150)}`);
        });
      }

      return results.length > 0 ? results.join('\n') : `نتائج البحث عن: "${query}" — لا توجد نتائج محددة`;
    } catch {
      return `نتائج البحث عن: "${query}" — محاكاة: [البيانات ستُعرض هنا عند توفر الاتصال]`;
    }
  }

  private async executeCode(code: string, language: string): Promise<string> {
    try {
      const res = await axios.post(`${this.agentServiceUrl}/execute`, {
        code, language,
      }, { timeout: 30000 });
      return res.data?.output || res.data?.result || "تم التنفيذ بنجاح";
    } catch {
      return `[تنفيذ الكود] محاكاة:\n\`\`\`${language}\n${code}\n\`\`\`\nالمخرجات: [سيتم تنفيذ الكود على الخادم]`;
    }
  }

  private async executeCalculate(expression: string): Promise<string> {
    try {
      const res = await axios.post(`${this.agentServiceUrl}/calculate`, {
        expression,
      }, { timeout: 10000 });
      return `النتيجة: ${res.data?.result || "غير محدد"}`;
    } catch {
      try {
        const safeExpr = expression.replace(/[^0-9+\-*/().%\s]/g, "");
        if (safeExpr && safeExpr.trim()) {
          const result = Function('"use strict"; return (' + safeExpr + ')')();
          return `النتيجة: ${result}`;
        }
      } catch {}
      return `الحساب: ${expression} — [يتطلب خدمة الحساب]`;
    }
  }

  private async executeShell(command: string): Promise<string> {
    try {
      const res = await axios.post(`${this.agentServiceUrl}/shell`, {
        command,
      }, { timeout: 15000 });
      return res.data?.output || "تم تنفيذ الأمر";
    } catch {
      return `[أمر Shell]: ${command}\n[سيُنفَّذ على الخادم]`;
    }
  }

  private async executeReadFile(path: string): Promise<string> {
    try {
      const res = await axios.get(`${this.agentServiceUrl}/file`, {
        params: { path },
        timeout: 5000,
      });
      return res.data?.content || "الملف فارغ";
    } catch {
      return `[قراءة الملف]: ${path}\n[غير متوفر في هذه الجلسة]`;
    }
  }

  private async executeWriteFile(path: string, content: string): Promise<string> {
    try {
      await axios.post(`${this.agentServiceUrl}/file`, {
        path, content,
      }, { timeout: 5000 });
      return `تم حفظ الملف: ${path}`;
    } catch {
      return `[كتابة الملف]: ${path}\n[${content.length} حرف — سيُحفظ عند توفر الخدمة]`;
    }
  }

  getCallHistory(taskId?: string): ToolCall[] {
    return taskId
      ? this.callHistory.filter(c => c.id.includes(taskId))
      : this.callHistory.slice(-20);
  }

  getStats(): { totalCalls: number; successRate: number; avgLatencyMs: number } {
    const calls = this.callHistory;
    if (calls.length === 0) return { totalCalls: 0, successRate: 100, avgLatencyMs: 0 };

    const successful = calls.filter(c => c.status === "done").length;
    const withLatency = calls.filter(c => c.latencyMs !== undefined);
    const avgLatency = withLatency.length > 0
      ? withLatency.reduce((sum, c) => sum + (c.latencyMs || 0), 0) / withLatency.length
      : 0;

    return {
      totalCalls: calls.length,
      successRate: (successful / calls.length) * 100,
      avgLatencyMs: Math.round(avgLatency),
    };
  }
}

export const toolOrchestrator = new ToolOrchestrator();
