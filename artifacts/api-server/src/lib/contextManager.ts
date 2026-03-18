/**
 * contextManager.ts — مدير السياق الذكي
 * ─────────────────────────────────────────────────────────────────────────────
 * مستوحى من Manus AI: إدارة ذكية لنافذة السياق لتجنب تجاوز الحد الأقصى
 *   1. ضغط الرسائل القديمة مع الحفاظ على المعلومات الجوهرية
 *   2. تثبيت المعلومات الأساسية (الهدف، القرارات المهمة)
 *   3. ذاكرة عاملة للحقائق المستخلصة
 *   4. تلخيص تدريجي للخطوات السابقة
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface PinnedFact {
  id: string;
  content: string;
  importance: "critical" | "high" | "medium";
  addedAt: Date;
}

export interface ContextWindow {
  taskId: string;
  goal: string;
  pinnedFacts: PinnedFact[];
  workingMemory: string[];
  recentMessages: Array<{ role: string; content: string }>;
  compressedSummary: string;
  totalTokensEstimate: number;
  maxTokens: number;
}

// ══════════════════════════════════════════════════════════════════════════════
// تقدير عدد الرموز (تقريبي)
// ══════════════════════════════════════════════════════════════════════════════

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

// ══════════════════════════════════════════════════════════════════════════════
// استخلاص الحقائق من النص
// ══════════════════════════════════════════════════════════════════════════════

function extractKeyFacts(text: string): string[] {
  const facts: string[] = [];
  const lines = text.split('\n').filter(l => l.trim().length > 20);

  // الحقائق المهمة: تبدأ برقم، أو نتيجة، أو خطأ
  const important = lines.filter(l =>
    /^\d+\.|نتيجة:|خطأ:|ملاحظة:|مهم:|تم:|✓|✗|URL:|رابط:|كود:|result:|error:|note:|important:/i.test(l.trim())
  );

  return important.slice(0, 5).map(l => l.trim().substring(0, 200));
}

// ══════════════════════════════════════════════════════════════════════════════
// فئة مدير السياق
// ══════════════════════════════════════════════════════════════════════════════

export class ContextManager {
  private windows: Map<string, ContextWindow> = new Map();
  private readonly DEFAULT_MAX_TOKENS = 3000;
  private readonly COMPRESSION_THRESHOLD = 0.75;

  initContext(taskId: string, goal: string): ContextWindow {
    const window: ContextWindow = {
      taskId,
      goal,
      pinnedFacts: [
        {
          id: "goal",
          content: `الهدف الرئيسي: ${goal}`,
          importance: "critical",
          addedAt: new Date(),
        },
      ],
      workingMemory: [],
      recentMessages: [],
      compressedSummary: "",
      totalTokensEstimate: estimateTokens(goal),
      maxTokens: this.DEFAULT_MAX_TOKENS,
    };

    this.windows.set(taskId, window);
    return window;
  }

  addMessage(taskId: string, role: string, content: string): void {
    const w = this.windows.get(taskId);
    if (!w) return;

    w.recentMessages.push({ role, content });
    w.totalTokensEstimate += estimateTokens(content);

    // استخلاص حقائق مهمة من النتائج
    if (role === "assistant" || role === "system") {
      const facts = extractKeyFacts(content);
      facts.forEach(f => {
        if (!w.workingMemory.includes(f)) {
          w.workingMemory.push(f);
        }
      });
      // احتفظ بأحدث 15 حقيقة فقط
      if (w.workingMemory.length > 15) {
        w.workingMemory = w.workingMemory.slice(-15);
      }
    }

    // ضغط إذا تجاوزنا العتبة
    if (w.totalTokensEstimate > w.maxTokens * this.COMPRESSION_THRESHOLD) {
      this.compress(w);
    }
  }

  pinFact(taskId: string, content: string, importance: PinnedFact["importance"] = "high"): void {
    const w = this.windows.get(taskId);
    if (!w) return;

    w.pinnedFacts.push({
      id: `fact_${Date.now()}`,
      content,
      importance,
      addedAt: new Date(),
    });
  }

  addToWorkingMemory(taskId: string, fact: string): void {
    const w = this.windows.get(taskId);
    if (!w) return;
    if (!w.workingMemory.includes(fact)) {
      w.workingMemory.push(fact);
      if (w.workingMemory.length > 20) {
        w.workingMemory = w.workingMemory.slice(-20);
      }
    }
  }

  private compress(window: ContextWindow): void {
    const msgCount = window.recentMessages.length;
    if (msgCount <= 4) return;

    // احتفظ فقط بأحدث 4 رسائل
    const toCompress = window.recentMessages.slice(0, msgCount - 4);
    const compressed = toCompress
      .map(m => `[${m.role}]: ${m.content.substring(0, 100)}...`)
      .join('\n');

    window.compressedSummary = compressed.length > 0
      ? (window.compressedSummary + '\n' + compressed).substring(0, 800)
      : window.compressedSummary;

    window.recentMessages = window.recentMessages.slice(-4);
    window.totalTokensEstimate = this.recalculateTokens(window);
  }

  private recalculateTokens(w: ContextWindow): number {
    let total = estimateTokens(w.goal) + estimateTokens(w.compressedSummary);
    w.pinnedFacts.forEach(f => total += estimateTokens(f.content));
    w.workingMemory.forEach(m => total += estimateTokens(m));
    w.recentMessages.forEach(m => total += estimateTokens(m.content));
    return total;
  }

  buildContextString(taskId: string): string {
    const w = this.windows.get(taskId);
    if (!w) return "";

    const parts: string[] = [];

    // الحقائق المثبتة (دائماً موجودة)
    const criticalFacts = w.pinnedFacts.filter(f => f.importance === "critical");
    const highFacts = w.pinnedFacts.filter(f => f.importance === "high");

    if (criticalFacts.length > 0) {
      parts.push("=== معلومات أساسية ===");
      criticalFacts.forEach(f => parts.push(f.content));
    }

    if (highFacts.length > 0) {
      parts.push("=== قرارات مهمة ===");
      highFacts.forEach(f => parts.push(f.content));
    }

    // الذاكرة العاملة
    if (w.workingMemory.length > 0) {
      parts.push("=== ملاحظات الجلسة ===");
      w.workingMemory.slice(-8).forEach(m => parts.push(`• ${m}`));
    }

    // ملخص الرسائل المضغوطة
    if (w.compressedSummary) {
      parts.push("=== سجل مختصر ===");
      parts.push(w.compressedSummary.substring(0, 400));
    }

    return parts.join('\n');
  }

  getRecentMessages(taskId: string): Array<{ role: string; content: string }> {
    return this.windows.get(taskId)?.recentMessages || [];
  }

  getWindow(taskId: string): ContextWindow | undefined {
    return this.windows.get(taskId);
  }

  clearSession(taskId: string): void {
    this.windows.delete(taskId);
  }

  getStats(taskId: string): { tokens: number; maxTokens: number; utilization: number; messageCount: number } {
    const w = this.windows.get(taskId);
    if (!w) return { tokens: 0, maxTokens: this.DEFAULT_MAX_TOKENS, utilization: 0, messageCount: 0 };
    return {
      tokens: w.totalTokensEstimate,
      maxTokens: w.maxTokens,
      utilization: w.totalTokensEstimate / w.maxTokens,
      messageCount: w.recentMessages.length,
    };
  }
}

export const contextManager = new ContextManager();
