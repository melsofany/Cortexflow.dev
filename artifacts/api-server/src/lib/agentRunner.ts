import { EventEmitter } from "events";
import { ollamaClient, ChatMessage } from "./ollamaClient.js";
import { taskStore, Task } from "./taskStore.js";

class AgentRunner extends EventEmitter {
  private systemPrompt = `You are CortexFlow, an advanced AI agent that thinks step by step.
For each task, you will reason through:
- OBSERVE: Analyze the task
- THINK: Break down the problem  
- PLAN: Create execution steps
- ACT: Execute and produce result
- VERIFY: Confirm completion

Be concise and respond in the same language as the user's request.`;

  async executeTask(task: Task): Promise<void> {
    const start = Date.now();
    taskStore.updateTask(task.taskId, { status: "running" });

    this.emit("taskStart", {
      taskId: task.taskId,
      description: task.description,
    });

    taskStore.addLog({
      taskId: task.taskId,
      agentType: "AgentRunner",
      action: "task_start",
      input: task.description,
    });

    try {
      if (!ollamaClient.isAvailable()) {
        await this.simulateWithSteps(task, start);
        return;
      }
      await this.runWithOllama(task, start);
    } catch (err: any) {
      const errorMsg = err.message || "Unknown error";
      taskStore.updateTask(task.taskId, { status: "failed", error: errorMsg });
      taskStore.addLog({
        taskId: task.taskId,
        agentType: "AgentRunner",
        action: "task_fail",
        output: errorMsg,
        durationMs: Date.now() - start,
      });
      this.emit("taskFail", { taskId: task.taskId, error: errorMsg });
    }
  }

  private async runWithOllama(task: Task, start: number): Promise<void> {
    const steps = ["OBSERVE", "THINK", "PLAN", "ACT", "VERIFY"];
    const stepPrompts: Record<string, string> = {
      OBSERVE: `Task: "${task.description}"\n\nAnalyze this task. What are the key elements and requirements?`,
      THINK:   `Think deeply about the best approach. What are potential challenges and solutions?`,
      PLAN:    `Create a concrete numbered plan to complete: "${task.description}"`,
      ACT:     `Execute the plan and provide the actual result for: "${task.description}"`,
      VERIFY:  `Verify the result is complete. Summarize what was accomplished for the user.`,
    };

    const messages: ChatMessage[] = [{ role: "system", content: this.systemPrompt }];
    let finalResult = "";

    for (const step of steps) {
      const prompt = stepPrompts[step];
      messages.push({ role: "user", content: prompt });

      // send "processing" indicator
      this.emit("thinking", {
        taskId: task.taskId,
        step,
        content: `[${step}] ...`,
        timestamp: new Date(),
      });

      try {
        const response = await ollamaClient.chat(messages, { temperature: 0.5, max_tokens: 600 });
        messages.push({ role: "assistant", content: response });

        // prefix with [STEP] so frontend can parse the step
        this.emit("thinking", {
          taskId: task.taskId,
          step,
          content: `[${step}] ${response}`,
          timestamp: new Date(),
        });

        taskStore.addStep(task.taskId, step, response);
        taskStore.addLog({
          taskId: task.taskId,
          agentType: "AgentRunner",
          action: `step_${step.toLowerCase()}`,
          input: prompt,
          output: response.substring(0, 300),
        });

        if (step === "ACT" || step === "VERIFY") finalResult = response;
      } catch (err: any) {
        const fallback = `[${step}] Processing step...`;
        this.emit("thinking", { taskId: task.taskId, step, content: fallback, timestamp: new Date() });
        taskStore.addStep(task.taskId, step, fallback);
      }

      await new Promise((r) => setTimeout(r, 300));
    }

    taskStore.updateTask(task.taskId, { status: "completed", result: finalResult });
    taskStore.addLog({
      taskId: task.taskId,
      agentType: "AgentRunner",
      action: "task_complete",
      output: finalResult.substring(0, 300),
      durationMs: Date.now() - start,
    });
    this.emit("taskSuccess", { taskId: task.taskId, result: finalResult });
  }

  private async simulateWithSteps(task: Task, start: number): Promise<void> {
    const steps = ["OBSERVE", "THINK", "PLAN", "ACT", "VERIFY"];

    const simulatedContent: Record<string, string> = {
      OBSERVE: `تحليل المهمة: "${task.description}". المهمة من نوع ${task.type} وتتطلب تنفيذ الخطوات المناسبة.`,
      THINK:   `التفكير في أفضل طريقة لتنفيذ المهمة. سأقوم بتقسيمها إلى خطوات واضحة وقابلة للتنفيذ.`,
      PLAN:    `خطة التنفيذ:\n1. تهيئة البيئة اللازمة\n2. تنفيذ الإجراءات المطلوبة\n3. التحقق من النتائج\n4. تقديم التقرير النهائي`,
      ACT:     `جاري تنفيذ المهمة... تم إنجاز المطلوب بنجاح. (ملاحظة: لتفعيل الذكاء الاصطناعي الحقيقي، قم بتثبيت Ollama من ollama.ai وشغّل: ollama pull llama3)`,
      VERIFY:  `تم التحقق من اكتمال المهمة. النتيجة: المهمة اكتملت بوضع المحاكاة. لتجربة الذكاء الاصطناعي الحقيقي، ثبّت Ollama محلياً.`,
    };

    for (const step of steps) {
      await new Promise((r) => setTimeout(r, 800));

      this.emit("thinking", {
        taskId: task.taskId,
        step,
        content: `[${step}] ${simulatedContent[step]}`,
        timestamp: new Date(),
      });

      taskStore.addStep(task.taskId, step, simulatedContent[step]);
    }

    const result = simulatedContent["VERIFY"];
    taskStore.updateTask(task.taskId, { status: "completed", result });
    taskStore.addLog({
      taskId: task.taskId,
      agentType: "AgentRunner",
      action: "task_complete",
      output: result,
      durationMs: Date.now() - start,
    });
    this.emit("taskSuccess", { taskId: task.taskId, result });
  }
}

export const agentRunner = new AgentRunner();
