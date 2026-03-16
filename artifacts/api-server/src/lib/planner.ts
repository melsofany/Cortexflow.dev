import { ChatMessage } from "./ollamaClient.js";

export interface PlanStep {
  id: number;
  title: string;
  description: string;
  agent: "browser" | "coder" | "researcher" | "reviewer" | "general";
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: string;
}

export interface TaskPlan {
  goal: string;
  steps: PlanStep[];
  category: string;
  estimatedTime: string;
  createdAt: Date;
}

const PLANNER_PROMPT = `أنت مخطط ذكاء اصطناعي محترف. مهمتك تحليل هدف المستخدم وتقسيمه إلى خطوات واضحة قابلة للتنفيذ.

قواعد مهمة:
- حدد من 2 إلى 6 خطوات فقط
- كل خطوة يجب أن تكون واضحة ومحددة
- حدد الوكيل المناسب لكل خطوة: browser, coder, researcher, reviewer, أو general
- استجب بـ JSON فقط، لا شيء آخر

تنسيق الاستجابة:
{
  "category": "browser|code|research|creative|math|general",
  "estimatedTime": "30 ثانية",
  "steps": [
    {
      "id": 1,
      "title": "عنوان قصير",
      "description": "وصف تفصيلي",
      "agent": "browser"
    }
  ]
}

أمثلة:
- "ابحث عن أخبار الذكاء الاصطناعي" → researcher يبحث → general يلخص
- "اكتب كود Python" → coder يكتب → reviewer يراجع
- "افتح يوتيوب" → browser يفتح الموقع → browser يبحث عن المحتوى`;

export class PlannerAgent {
  async createPlan(
    goal: string,
    smartChat: (messages: ChatMessage[], opts?: any) => Promise<string>,
  ): Promise<TaskPlan> {
    try {
      const response = await smartChat(
        [
          { role: "system", content: PLANNER_PROMPT },
          {
            role: "user",
            content: `الهدف: "${goal}"\n\nأنشئ خطة تنفيذ مفصلة. استجب بـ JSON فقط.`,
          },
        ],
        { temperature: 0.3, max_tokens: 600 },
      );

      const plan = this.parsePlan(response, goal);
      return plan;
    } catch (e) {
      return this.createFallbackPlan(goal);
    }
  }

  private parsePlan(response: string, goal: string): TaskPlan {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");

      const parsed = JSON.parse(jsonMatch[0]);

      const steps: PlanStep[] = (parsed.steps || []).map(
        (s: any, i: number) => ({
          id: s.id || i + 1,
          title: s.title || `خطوة ${i + 1}`,
          description: s.description || "",
          agent: this.validateAgent(s.agent),
          status: "pending" as const,
        }),
      );

      if (steps.length === 0) throw new Error("No steps");

      return {
        goal,
        steps,
        category: parsed.category || "general",
        estimatedTime: parsed.estimatedTime || "دقيقة واحدة",
        createdAt: new Date(),
      };
    } catch {
      return this.createFallbackPlan(goal);
    }
  }

  private validateAgent(
    agent: string,
  ): PlanStep["agent"] {
    const valid = ["browser", "coder", "researcher", "reviewer", "general"];
    return valid.includes(agent) ? (agent as PlanStep["agent"]) : "general";
  }

  private createFallbackPlan(goal: string): TaskPlan {
    const isBrowser =
      /افتح|اذهب|تصفح|ابحث في|سجل|open|browse|visit|search/i.test(goal);
    const isCode = /كود|برمجة|اكتب|code|script|program/i.test(goal);
    const isResearch = /ابحث عن|معلومات|research|find|analyze/i.test(goal);

    const steps: PlanStep[] = [];

    if (isBrowser) {
      steps.push(
        {
          id: 1,
          title: "تحليل المهمة",
          description: `تحديد الموقع المستهدف والإجراءات المطلوبة`,
          agent: "general",
          status: "pending",
        },
        {
          id: 2,
          title: "تنفيذ في المتصفح",
          description: `فتح المتصفح وتنفيذ: ${goal}`,
          agent: "browser",
          status: "pending",
        },
        {
          id: 3,
          title: "التحقق والنتيجة",
          description: "مراجعة نتيجة التنفيذ",
          agent: "reviewer",
          status: "pending",
        },
      );
    } else if (isCode) {
      steps.push(
        {
          id: 1,
          title: "تحليل المتطلبات",
          description: "فهم المتطلبات وتحديد النهج",
          agent: "general",
          status: "pending",
        },
        {
          id: 2,
          title: "كتابة الكود",
          description: `كتابة الحل البرمجي`,
          agent: "coder",
          status: "pending",
        },
        {
          id: 3,
          title: "مراجعة الكود",
          description: "التحقق من صحة الكود واقتراح التحسينات",
          agent: "reviewer",
          status: "pending",
        },
      );
    } else if (isResearch) {
      steps.push(
        {
          id: 1,
          title: "تحديد مصادر البحث",
          description: "تحديد أفضل مصادر المعلومات",
          agent: "researcher",
          status: "pending",
        },
        {
          id: 2,
          title: "جمع المعلومات",
          description: `البحث عن: ${goal}`,
          agent: "researcher",
          status: "pending",
        },
        {
          id: 3,
          title: "تلخيص النتائج",
          description: "تنظيم وتلخيص المعلومات المجمعة",
          agent: "general",
          status: "pending",
        },
      );
    } else {
      steps.push(
        {
          id: 1,
          title: "تحليل وفهم",
          description: `تحليل الطلب: ${goal}`,
          agent: "general",
          status: "pending",
        },
        {
          id: 2,
          title: "التنفيذ",
          description: "تنفيذ المهمة",
          agent: "general",
          status: "pending",
        },
        {
          id: 3,
          title: "المراجعة",
          description: "مراجعة النتيجة النهائية",
          agent: "reviewer",
          status: "pending",
        },
      );
    }

    return {
      goal,
      steps,
      category: isBrowser
        ? "browser"
        : isCode
          ? "code"
          : isResearch
            ? "research"
            : "general",
      estimatedTime: "دقيقة - دقيقتان",
      createdAt: new Date(),
    };
  }
}

export const plannerAgent = new PlannerAgent();
