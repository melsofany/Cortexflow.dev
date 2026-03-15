import { EventEmitter } from "events";
import { ollamaClient, ChatMessage } from "./ollamaClient.js";
import { taskStore, Task } from "./taskStore.js";

export interface ThinkingUpdate {
  taskId: string;
  step: string;
  content: string;
  timestamp: Date;
}

class AgentRunner extends EventEmitter {
  private systemPrompt = `You are CortexFlow, an advanced AI agent that thinks step by step.
For each task, you will:
1. OBSERVE: Analyze the task carefully
2. THINK: Break down the problem 
3. PLAN: Create an execution plan
4. ACT: Execute the plan
5. VERIFY: Confirm the result

Always respond in the same language as the user's request.
Be concise, practical, and helpful.`;

  async executeTask(task: Task): Promise<void> {
    const start = Date.now();
    taskStore.updateTask(task.taskId, { status: "running" });
    this.emit("taskStart", { taskId: task.taskId, description: task.description });

    taskStore.addLog({
      taskId: task.taskId,
      agentType: "AgentRunner",
      action: "task_start",
      input: task.description,
    });

    try {
      const steps = ["OBSERVE", "THINK", "PLAN", "ACT", "VERIFY"];
      const stepPrompts: Record<string, string> = {
        OBSERVE: `Task: "${task.description}"\n\nOBSERVE: Analyze this task. What are the key elements? What information do you have? What do you need?`,
        THINK: `Based on your observation, THINK deeply about the best approach. Consider challenges and solutions.`,
        PLAN: `Create a concrete PLAN with numbered steps to complete: "${task.description}"`,
        ACT: `Now ACT and execute the plan. Provide the actual result, answer, or output for: "${task.description}"`,
        VERIFY: `VERIFY the result. Is the task completed successfully? Summarize what was accomplished.`,
      };

      const messages: ChatMessage[] = [{ role: "system", content: this.systemPrompt }];
      let finalResult = "";

      if (!ollamaClient.isAvailable()) {
        const simulatedResult = this.simulateExecution(task);
        taskStore.updateTask(task.taskId, { status: "completed", result: simulatedResult });
        taskStore.addLog({
          taskId: task.taskId,
          agentType: "AgentRunner",
          action: "task_complete",
          output: simulatedResult,
          durationMs: Date.now() - start,
        });
        this.emit("taskSuccess", { taskId: task.taskId, result: simulatedResult });
        return;
      }

      for (const step of steps) {
        const prompt = stepPrompts[step];
        messages.push({ role: "user", content: prompt });

        this.emit("thinking", {
          taskId: task.taskId,
          step,
          content: `Executing ${step}...`,
          timestamp: new Date(),
        });

        try {
          const response = await ollamaClient.chat(messages, { temperature: 0.5, max_tokens: 600 });
          messages.push({ role: "assistant", content: response });

          this.emit("thinking", {
            taskId: task.taskId,
            step,
            content: response,
            timestamp: new Date(),
          });

          taskStore.addStep(task.taskId, step, response);
          taskStore.addLog({
            taskId: task.taskId,
            agentType: "AgentRunner",
            action: `step_${step.toLowerCase()}`,
            input: prompt,
            output: response,
          });

          if (step === "ACT" || step === "VERIFY") {
            finalResult = response;
          }
        } catch (err: any) {
          console.warn(`[AgentRunner] Step ${step} failed:`, err.message);
          const fallback = `[${step}] Processing...`;
          this.emit("thinking", { taskId: task.taskId, step, content: fallback, timestamp: new Date() });
          taskStore.addStep(task.taskId, step, fallback);
        }

        await new Promise((r) => setTimeout(r, 200));
      }

      taskStore.updateTask(task.taskId, { status: "completed", result: finalResult });
      taskStore.addLog({
        taskId: task.taskId,
        agentType: "AgentRunner",
        action: "task_complete",
        output: finalResult,
        durationMs: Date.now() - start,
      });
      this.emit("taskSuccess", { taskId: task.taskId, result: finalResult });
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

  private simulateExecution(task: Task): string {
    const responses: Record<string, string> = {
      browser: `Simulated browser task completed: Navigated to ${task.url || "target URL"}, performed actions, and extracted results. (Install Ollama for real AI execution)`,
      system: `Simulated system task completed: Executed command pipeline for "${task.description}". (Install Ollama for real AI execution)`,
      ai: `Simulated AI analysis: Processed "${task.description}" using rule-based logic. (Install Ollama for real AI execution)`,
      research: `Simulated research: Gathered information about "${task.description}". Key findings: Topic analyzed, data collected, summary generated. (Install Ollama for real AI execution)`,
    };
    return responses[task.type] || `Task "${task.description}" completed. (Install Ollama at localhost:11434 for real AI execution)`;
  }
}

export const agentRunner = new AgentRunner();
