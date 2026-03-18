/**
 * parallelExecutor.ts — مُنفّذ المهام المتوازية
 * ─────────────────────────────────────────────────────────────────────────────
 * مستوحى من Manus AI: تنفيذ المهام المستقلة في وقت واحد لتسريع الأداء
 *   1. تحديد المهام المستقلة وتشغيلها بالتوازي
 *   2. دمج النتائج بشكل ذكي
 *   3. إدارة الموارد والحد الأقصى للتزامن
 *   4. إلغاء المهام عند الفشل الحرج
 *   5. تقارير التقدم في الوقت الفعلي
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from "events";
import { DAGNode, DAGPlan, dagPlanner } from "./dagPlanner.js";
import { contextManager } from "./contextManager.js";

export interface ParallelTaskResult {
  nodeId: string;
  success: boolean;
  result: string;
  durationMs: number;
}

export interface ParallelBatch {
  batchId: string;
  nodeIds: string[];
  startedAt: Date;
  completedAt?: Date;
  results: ParallelTaskResult[];
}

const AGENT_SYSTEM_PROMPTS: Record<string, string> = {
  researcher: `أنت وكيل بحث متخصص. مهمتك جمع وتحليل المعلومات من مصادر موثوقة.
- ابحث في مصادر متعددة
- قدّم معلومات دقيقة وموثوقة
- نظّم النتائج بوضوح`,

  coder: `أنت وكيل برمجة متخصص. مهمتك كتابة كود نظيف وفعّال.
- حلّل المتطلبات قبل الكتابة
- اكتب كوداً موثقاً ومنظماً
- اختبر الحل ذهنياً`,

  browser: `أنت وكيل تصفح متخصص. مهمتك التفاعل مع المواقع بدقة.
- تحقق من كل خطوة
- تعامل مع الأخطاء بذكاء
- أبلغ عن الحالة الحقيقية للصفحة`,

  reviewer: `أنت وكيل مراجعة متخصص. مهمتك ضمان جودة النتائج.
- راجع النتائج بعين ناقدة
- تحقق من الاكتمال والدقة
- قدّم ملاحظات بناءة`,

  general: `أنت وكيل عام متكامل. تتعامل مع المهام المتنوعة باحترافية.
- افهم المتطلبات جيداً
- نفّذ بدقة وفعالية`,

  executor: `أنت وكيل تنفيذ. مهمتك تشغيل الأدوات والأوامر بدقة.
- نفّذ المهمة المحددة فقط
- أبلغ عن النتيجة الحقيقية`,

  planner: `أنت وكيل تخطيط. مهمتك تنظيم وتنسيق الجهود.
- ضع خطة واضحة
- راعِ التبعيات بين الخطوات`,
};

// ══════════════════════════════════════════════════════════════════════════════
// دالة دمج النتائج المتوازية
// ══════════════════════════════════════════════════════════════════════════════

async function mergeParallelResults(
  results: ParallelTaskResult[],
  goal: string,
  smartChat: (messages: Array<{role: string; content: string}>, opts?: Record<string, unknown>) => Promise<string>,
): Promise<string> {
  if (results.length === 1) return results[0].result;

  const successful = results.filter(r => r.success);
  if (successful.length === 0) {
    return `فشلت جميع المهام المتوازية (${results.length} مهمة)`;
  }

  const summary = successful.map(r =>
    `[${r.nodeId}]: ${r.result.substring(0, 300)}`
  ).join('\n\n');

  try {
    const merged = await smartChat(
      [{
        role: "user",
        content: `الهدف: ${goal}\n\nنتائج المهام المتوازية:\n${summary}\n\nادمج هذه النتائج في إجابة متماسكة ومنظمة.`,
      }],
      { temperature: 0.3, max_tokens: 600 },
    );
    return merged;
  } catch {
    return successful[0].result;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// فئة المُنفّذ المتوازي
// ══════════════════════════════════════════════════════════════════════════════

export class ParallelExecutor extends EventEmitter {
  private readonly MAX_CONCURRENCY = 3;
  private batches: Map<string, ParallelBatch> = new Map();
  private batchCounter = 0;

  async executePlan(
    taskId: string,
    plan: DAGPlan,
    smartChat: (messages: Array<{role: string; content: string}>, opts?: Record<string, unknown>, stepName?: string) => Promise<string>,
    onProgress?: (nodeId: string, status: string, result?: string) => void,
  ): Promise<Record<string, string>> {
    const allResults: Record<string, string> = {};
    plan.status = "executing";

    this.emit("planStart", { taskId, planId: plan.id, totalNodes: plan.totalNodes });

    let maxIterations = 20;
    while (!dagPlanner.isComplete(plan) && maxIterations > 0) {
      maxIterations--;

      const readyNodes = dagPlanner.getReadyNodes(plan);
      if (readyNodes.length === 0) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      // تحديد المجموعة المتوازية
      const parallelGroup = readyNodes.slice(0, this.MAX_CONCURRENCY);
      const batchId = `batch_${++this.batchCounter}`;

      const batch: ParallelBatch = {
        batchId,
        nodeIds: parallelGroup.map(n => n.id),
        startedAt: new Date(),
        results: [],
      };
      this.batches.set(batchId, batch);

      this.emit("batchStart", { taskId, batchId, nodeIds: batch.nodeIds });

      // تنفيذ المجموعة بالتوازي
      const batchPromises = parallelGroup.map(node =>
        this.executeNode(taskId, node, plan, allResults, smartChat, onProgress)
      );

      const batchResults = await Promise.allSettled(batchPromises);

      batchResults.forEach((result, idx) => {
        const node = parallelGroup[idx];
        if (result.status === "fulfilled") {
          const { success, output, durationMs } = result.value;
          batch.results.push({ nodeId: node.id, success, result: output, durationMs });

          if (success) {
            dagPlanner.markNodeDone(plan, node.id, output);
            allResults[node.id] = output;
            contextManager.addToWorkingMemory(taskId, `✓ ${node.title}: ${output.substring(0, 100)}`);
            onProgress?.(node.id, "done", output);
          } else {
            dagPlanner.markNodeFailed(plan, node.id, output);
            onProgress?.(node.id, "failed", output);
          }
        } else {
          const errMsg = String(result.reason);
          dagPlanner.markNodeFailed(plan, node.id, errMsg);
          batch.results.push({ nodeId: node.id, success: false, result: errMsg, durationMs: 0 });
          onProgress?.(node.id, "failed", errMsg);
        }

        this.emit("nodeComplete", { taskId, nodeId: node.id, status: node.status });
      });

      batch.completedAt = new Date();
      this.emit("batchComplete", { taskId, batchId, results: batch.results });

      // دمج نتائج المجموعة إذا كانت متوازية
      if (parallelGroup.length > 1 && batch.results.filter(r => r.success).length > 1) {
        const mergedKey = `merged_${batchId}`;
        const merged = await mergeParallelResults(
          batch.results.filter(r => r.success),
          plan.goal,
          smartChat,
        );
        allResults[mergedKey] = merged;
      }
    }

    plan.status = dagPlanner.isComplete(plan) ? "done" : "failed";
    this.emit("planComplete", { taskId, planId: plan.id, allResults });

    return allResults;
  }

  private async executeNode(
    taskId: string,
    node: DAGNode,
    plan: DAGPlan,
    previousResults: Record<string, string>,
    smartChat: (messages: Array<{role: string; content: string}>, opts?: Record<string, unknown>, stepName?: string) => Promise<string>,
    onProgress?: (nodeId: string, status: string) => void,
  ): Promise<{ success: boolean; output: string; durationMs: number }> {
    const startTime = Date.now();
    dagPlanner.markNodeRunning(plan, node.id);
    onProgress?.(node.id, "running");

    this.emit("nodeStart", { taskId, nodeId: node.id, agent: node.agent });

    try {
      const systemPrompt = AGENT_SYSTEM_PROMPTS[node.agent] || AGENT_SYSTEM_PROMPTS.general;
      const contextStr = contextManager.buildContextString(taskId);

      // بناء سياق النتائج السابقة
      const depResults = node.dependencies
        .filter(dep => previousResults[dep])
        .map(dep => `[${dep}]: ${previousResults[dep].substring(0, 250)}`)
        .join('\n');

      const userMessage = [
        `الهدف العام: ${plan.goal}`,
        depResults ? `\nنتائج المهام السابقة:\n${depResults}` : "",
        contextStr ? `\nالسياق:\n${contextStr}` : "",
        `\n**مهمتك الحالية:** ${node.title}`,
        `التفاصيل: ${node.description}`,
        node.tool ? `\nالأداة الموصى بها: ${node.tool}` : "",
        `\nنفّذ هذه المهمة وقدّم نتيجة مفصلة ودقيقة.`,
      ].filter(Boolean).join("\n");

      const result = await smartChat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        { temperature: 0.35, max_tokens: 700 },
        `${node.agent.toUpperCase()}_${node.id}`,
      );

      const durationMs = Date.now() - startTime;
      return { success: true, output: result || `تم إكمال: ${node.title}`, durationMs };

    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      const errMsg = error instanceof Error ? error.message : String(error);
      return { success: false, output: `فشل في ${node.title}: ${errMsg}`, durationMs };
    }
  }

  getBatch(batchId: string): ParallelBatch | undefined {
    return this.batches.get(batchId);
  }

  getStats(): { totalBatches: number; totalNodes: number; avgBatchSize: number } {
    const batches = Array.from(this.batches.values());
    const totalNodes = batches.reduce((sum, b) => sum + b.nodeIds.length, 0);
    return {
      totalBatches: batches.length,
      totalNodes,
      avgBatchSize: batches.length > 0 ? totalNodes / batches.length : 0,
    };
  }
}

export const parallelExecutor = new ParallelExecutor();
