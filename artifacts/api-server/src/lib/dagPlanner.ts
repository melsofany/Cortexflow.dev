/**
 * dagPlanner.ts — مخطط المهام الموجه (DAG)
 * ─────────────────────────────────────────────────────────────────────────────
 * مستوحى من Manus AI: تخطيط المهام كرسم بياني موجه (Directed Acyclic Graph)
 * بدلاً من الخطوات المتسلسلة البسيطة، يدعم:
 *   1. التنفيذ المتوازي للمهام المستقلة
 *   2. تبعيات صريحة بين الخطوات
 *   3. المسارات البديلة عند الفشل
 *   4. تقدير الأولويات والموارد
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type AgentRole = "planner" | "browser" | "coder" | "researcher" | "reviewer" | "general" | "executor";
export type NodeStatus = "pending" | "ready" | "running" | "done" | "failed" | "skipped";
export type TaskCategory = "browser" | "code" | "research" | "creative" | "math" | "general" | "multi-step";

export interface DAGNode {
  id: string;
  title: string;
  description: string;
  agent: AgentRole;
  tool?: string;
  toolInput?: Record<string, unknown>;
  status: NodeStatus;
  dependencies: string[];
  result?: string;
  error?: string;
  retries: number;
  maxRetries: number;
  priority: number;
  estimatedSeconds: number;
  startedAt?: Date;
  completedAt?: Date;
  isParallel: boolean;
}

export interface DAGPlan {
  id: string;
  goal: string;
  category: TaskCategory;
  nodes: Map<string, DAGNode>;
  executionOrder: string[][];
  createdAt: Date;
  status: "planning" | "executing" | "done" | "failed";
  totalNodes: number;
  completedNodes: number;
}

export interface DAGExecutionResult {
  planId: string;
  goal: string;
  success: boolean;
  results: Record<string, string>;
  summary: string;
  executionTimeMs: number;
}

// ══════════════════════════════════════════════════════════════════════════════
// مُحلّل الخطة إلى DAG
// ══════════════════════════════════════════════════════════════════════════════

const DAG_PLANNER_PROMPT = `أنت مخطط مهام متقدم. مهمتك تحليل الهدف وإنشاء خطة تنفيذ كـ Directed Acyclic Graph (DAG).

قواعد التخطيط:
- حدد من 3 إلى 8 مهام
- المهام المستقلة تُنفَّذ بالتوازي (isParallel: true)
- المهام التي تعتمد على نتيجة مهمة أخرى تُدرج في dependencies
- كل مهمة لها أولوية (1=عالية، 5=منخفضة)
- حدد الوكيل الأنسب: browser, coder, researcher, reviewer, general, executor
- حدد الأداة المناسبة: web_search, execute_code, browser_navigate, read_file, write_file, calculate, shell_run

الوكلاء المتاحون:
- researcher: للبحث عن معلومات وتحليل البيانات
- coder: لكتابة ومراجعة الكود
- browser: للتصفح والتفاعل مع المواقع
- executor: لتنفيذ الأوامر والأدوات
- reviewer: لمراجعة النتائج وضمان الجودة
- general: للمهام العامة والتلخيص

استجب بـ JSON فقط بهذا التنسيق الدقيق:
{
  "category": "browser|code|research|creative|math|general|multi-step",
  "nodes": [
    {
      "id": "node_1",
      "title": "عنوان قصير",
      "description": "وصف تفصيلي للمهمة",
      "agent": "researcher",
      "tool": "web_search",
      "toolInput": {"query": "..."},
      "dependencies": [],
      "priority": 1,
      "estimatedSeconds": 30,
      "isParallel": false,
      "maxRetries": 2
    }
  ]
}`;

// ══════════════════════════════════════════════════════════════════════════════
// حساب ترتيب التنفيذ (Topological Sort)
// ══════════════════════════════════════════════════════════════════════════════

function topologicalSort(nodes: Map<string, DAGNode>): string[][] {
  const levels: string[][] = [];
  const completed = new Set<string>();
  const allIds = Array.from(nodes.keys());

  let remaining = new Set(allIds);
  let iterations = 0;

  while (remaining.size > 0 && iterations < 20) {
    iterations++;
    const currentLevel: string[] = [];

    for (const id of remaining) {
      const node = nodes.get(id)!;
      const depsCompleted = node.dependencies.every(d => completed.has(d));
      if (depsCompleted) {
        currentLevel.push(id);
      }
    }

    if (currentLevel.length === 0) {
      // دورة في التبعيات — أضف الباقية بأمان
      remaining.forEach(id => currentLevel.push(id));
    }

    levels.push(currentLevel);
    currentLevel.forEach(id => {
      completed.add(id);
      remaining.delete(id);
    });
  }

  return levels;
}

// ══════════════════════════════════════════════════════════════════════════════
// فئة DAG Planner الرئيسية
// ══════════════════════════════════════════════════════════════════════════════

export class DAGPlanner {
  private planCounter = 0;

  async createDAGPlan(
    goal: string,
    smartChat: (messages: Array<{role: string; content: string}>, opts?: Record<string, unknown>) => Promise<string>,
  ): Promise<DAGPlan> {
    const planId = `plan_${++this.planCounter}_${Date.now()}`;

    try {
      const response = await smartChat(
        [
          { role: "system", content: DAG_PLANNER_PROMPT },
          { role: "user", content: `الهدف: "${goal}"\n\nأنشئ خطة DAG مفصلة. استجب بـ JSON فقط.` },
        ],
        { temperature: 0.2, max_tokens: 1200 },
      );

      return this.parseDAGResponse(response, goal, planId);
    } catch (e) {
      console.log(`[DAGPlanner] فشل في إنشاء الخطة: ${e}`);
      return this.createFallbackPlan(goal, planId);
    }
  }

  private parseDAGResponse(response: string, goal: string, planId: string): DAGPlan {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");

      const parsed = JSON.parse(jsonMatch[0]);
      const nodes = new Map<string, DAGNode>();

      (parsed.nodes || []).forEach((n: Record<string, unknown>) => {
        const id = String(n.id || `node_${nodes.size + 1}`);
        nodes.set(id, {
          id,
          title: String(n.title || "مهمة"),
          description: String(n.description || ""),
          agent: this.validateAgent(String(n.agent || "general")),
          tool: n.tool ? String(n.tool) : undefined,
          toolInput: n.toolInput as Record<string, unknown> | undefined,
          status: "pending",
          dependencies: Array.isArray(n.dependencies) ? n.dependencies.map(String) : [],
          result: undefined,
          error: undefined,
          retries: 0,
          maxRetries: Number(n.maxRetries) || 2,
          priority: Number(n.priority) || 3,
          estimatedSeconds: Number(n.estimatedSeconds) || 30,
          isParallel: Boolean(n.isParallel),
        });
      });

      if (nodes.size === 0) throw new Error("No nodes found");

      const executionOrder = topologicalSort(nodes);

      return {
        id: planId,
        goal,
        category: this.validateCategory(String(parsed.category || "general")),
        nodes,
        executionOrder,
        createdAt: new Date(),
        status: "planning",
        totalNodes: nodes.size,
        completedNodes: 0,
      };
    } catch (e) {
      console.log(`[DAGPlanner] فشل في تحليل الاستجابة: ${e}`);
      return this.createFallbackPlan(goal, planId);
    }
  }

  private createFallbackPlan(goal: string, planId: string): DAGPlan {
    const isBrowser = /افتح|اذهب|تصفح|ابحث في|open|browse|visit/i.test(goal);
    const isCode = /كود|برمجة|اكتب|code|script|program/i.test(goal);
    const isResearch = /ابحث|معلومات|research|find|analyze|شرح|explain/i.test(goal);

    const nodes = new Map<string, DAGNode>();

    if (isResearch) {
      nodes.set("research", {
        id: "research", title: "البحث والجمع", description: `البحث عن: ${goal}`,
        agent: "researcher", tool: "web_search", toolInput: { query: goal },
        status: "pending", dependencies: [], result: undefined, error: undefined,
        retries: 0, maxRetries: 2, priority: 1, estimatedSeconds: 30, isParallel: false,
      });
      nodes.set("analyze", {
        id: "analyze", title: "التحليل والتنظيم", description: "تحليل المعلومات المجمعة",
        agent: "researcher", tool: undefined, toolInput: undefined,
        status: "pending", dependencies: ["research"], result: undefined, error: undefined,
        retries: 0, maxRetries: 2, priority: 2, estimatedSeconds: 20, isParallel: false,
      });
      nodes.set("summarize", {
        id: "summarize", title: "التلخيص النهائي", description: "تقديم ملخص منظم",
        agent: "reviewer", tool: undefined, toolInput: undefined,
        status: "pending", dependencies: ["analyze"], result: undefined, error: undefined,
        retries: 0, maxRetries: 1, priority: 3, estimatedSeconds: 15, isParallel: false,
      });
    } else if (isCode) {
      nodes.set("requirements", {
        id: "requirements", title: "تحليل المتطلبات", description: "فهم المتطلبات",
        agent: "general", tool: undefined, toolInput: undefined,
        status: "pending", dependencies: [], result: undefined, error: undefined,
        retries: 0, maxRetries: 2, priority: 1, estimatedSeconds: 15, isParallel: false,
      });
      nodes.set("code", {
        id: "code", title: "كتابة الكود", description: `كتابة الحل لـ: ${goal}`,
        agent: "coder", tool: "execute_code", toolInput: undefined,
        status: "pending", dependencies: ["requirements"], result: undefined, error: undefined,
        retries: 0, maxRetries: 3, priority: 1, estimatedSeconds: 45, isParallel: false,
      });
      nodes.set("review", {
        id: "review", title: "مراجعة الكود", description: "التحقق من الجودة والصحة",
        agent: "reviewer", tool: undefined, toolInput: undefined,
        status: "pending", dependencies: ["code"], result: undefined, error: undefined,
        retries: 0, maxRetries: 1, priority: 2, estimatedSeconds: 20, isParallel: false,
      });
    } else if (isBrowser) {
      nodes.set("navigate", {
        id: "navigate", title: "التنقل في المتصفح", description: `تنفيذ: ${goal}`,
        agent: "browser", tool: "browser_navigate", toolInput: undefined,
        status: "pending", dependencies: [], result: undefined, error: undefined,
        retries: 0, maxRetries: 3, priority: 1, estimatedSeconds: 60, isParallel: false,
      });
      nodes.set("verify", {
        id: "verify", title: "التحقق من النتيجة", description: "مراجعة ما تم تنفيذه",
        agent: "reviewer", tool: undefined, toolInput: undefined,
        status: "pending", dependencies: ["navigate"], result: undefined, error: undefined,
        retries: 0, maxRetries: 1, priority: 2, estimatedSeconds: 15, isParallel: false,
      });
    } else {
      nodes.set("think", {
        id: "think", title: "التحليل والتفكير", description: `تحليل: ${goal}`,
        agent: "general", tool: undefined, toolInput: undefined,
        status: "pending", dependencies: [], result: undefined, error: undefined,
        retries: 0, maxRetries: 2, priority: 1, estimatedSeconds: 20, isParallel: false,
      });
      nodes.set("execute", {
        id: "execute", title: "التنفيذ", description: "تنفيذ المهمة",
        agent: "general", tool: undefined, toolInput: undefined,
        status: "pending", dependencies: ["think"], result: undefined, error: undefined,
        retries: 0, maxRetries: 2, priority: 1, estimatedSeconds: 30, isParallel: false,
      });
      nodes.set("final", {
        id: "final", title: "النتيجة النهائية", description: "تقديم الإجابة النهائية",
        agent: "reviewer", tool: undefined, toolInput: undefined,
        status: "pending", dependencies: ["execute"], result: undefined, error: undefined,
        retries: 0, maxRetries: 1, priority: 2, estimatedSeconds: 10, isParallel: false,
      });
    }

    const category: TaskCategory = isBrowser ? "browser" : isCode ? "code" : isResearch ? "research" : "general";

    return {
      id: planId,
      goal,
      category,
      nodes,
      executionOrder: topologicalSort(nodes),
      createdAt: new Date(),
      status: "planning",
      totalNodes: nodes.size,
      completedNodes: 0,
    };
  }

  private validateAgent(agent: string): AgentRole {
    const valid: AgentRole[] = ["planner", "browser", "coder", "researcher", "reviewer", "general", "executor"];
    return valid.includes(agent as AgentRole) ? (agent as AgentRole) : "general";
  }

  private validateCategory(cat: string): TaskCategory {
    const valid: TaskCategory[] = ["browser", "code", "research", "creative", "math", "general", "multi-step"];
    return valid.includes(cat as TaskCategory) ? (cat as TaskCategory) : "general";
  }

  getReadyNodes(plan: DAGPlan): DAGNode[] {
    const ready: DAGNode[] = [];
    for (const node of plan.nodes.values()) {
      if (node.status !== "pending") continue;
      const depsOk = node.dependencies.every(dep => {
        const depNode = plan.nodes.get(dep);
        return depNode?.status === "done";
      });
      if (depsOk) ready.push(node);
    }
    return ready.sort((a, b) => a.priority - b.priority);
  }

  markNodeRunning(plan: DAGPlan, nodeId: string): void {
    const node = plan.nodes.get(nodeId);
    if (node) { node.status = "running"; node.startedAt = new Date(); }
  }

  markNodeDone(plan: DAGPlan, nodeId: string, result: string): void {
    const node = plan.nodes.get(nodeId);
    if (node) {
      node.status = "done";
      node.result = result;
      node.completedAt = new Date();
      plan.completedNodes++;
    }
  }

  markNodeFailed(plan: DAGPlan, nodeId: string, error: string): void {
    const node = plan.nodes.get(nodeId);
    if (node) {
      node.status = "failed";
      node.error = error;
      node.retries++;
      if (node.retries < node.maxRetries) {
        node.status = "pending";
      }
    }
  }

  isComplete(plan: DAGPlan): boolean {
    for (const node of plan.nodes.values()) {
      if (node.status === "pending" || node.status === "running" || node.status === "ready") return false;
    }
    return true;
  }

  toJSON(plan: DAGPlan): object {
    return {
      id: plan.id,
      goal: plan.goal,
      category: plan.category,
      status: plan.status,
      totalNodes: plan.totalNodes,
      completedNodes: plan.completedNodes,
      executionOrder: plan.executionOrder,
      nodes: Array.from(plan.nodes.values()).map(n => ({
        id: n.id,
        title: n.title,
        description: n.description,
        agent: n.agent,
        tool: n.tool,
        status: n.status,
        dependencies: n.dependencies,
        result: n.result ? n.result.substring(0, 300) : undefined,
        error: n.error,
        retries: n.retries,
        priority: n.priority,
        estimatedSeconds: n.estimatedSeconds,
        isParallel: n.isParallel,
      })),
    };
  }
}

export const dagPlanner = new DAGPlanner();
