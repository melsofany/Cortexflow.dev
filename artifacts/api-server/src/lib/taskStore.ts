import { v4 as uuidv4 } from "uuid";

export type TaskStatus = "pending" | "running" | "completed" | "failed";
export type TaskType = "browser" | "system" | "ai" | "research";

export interface Task {
  taskId: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: number;
  createdAt: string;
  updatedAt: string;
  result?: string;
  error?: string;
  url?: string;
  steps?: TaskStep[];
}

export interface TaskStep {
  step: string;
  content: string;
  timestamp: string;
}

export interface LogEntry {
  id: string;
  taskId?: string;
  agentType?: string;
  action: string;
  input?: string;
  output?: string;
  durationMs?: number;
  createdAt: string;
}

class TaskStore {
  private tasks: Map<string, Task> = new Map();
  private logs: LogEntry[] = [];

  createTask(data: { description: string; type: TaskType; url?: string; priority?: number }): Task {
    const task: Task = {
      taskId: uuidv4(),
      description: data.description,
      type: data.type,
      status: "pending",
      priority: data.priority ?? 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      url: data.url,
      steps: [],
    };
    this.tasks.set(task.taskId, task);
    return task;
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  updateTask(taskId: string, updates: Partial<Task>): Task | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    const updated = { ...task, ...updates, updatedAt: new Date().toISOString() };
    this.tasks.set(taskId, updated);
    return updated;
  }

  addStep(taskId: string, step: string, content: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (!task.steps) task.steps = [];
    task.steps.push({ step, content, timestamp: new Date().toISOString() });
    task.updatedAt = new Date().toISOString();
    this.tasks.set(taskId, task);
  }

  addLog(entry: Omit<LogEntry, "id" | "createdAt">): LogEntry {
    const log: LogEntry = {
      ...entry,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    this.logs.unshift(log);
    if (this.logs.length > 500) this.logs = this.logs.slice(0, 500);
    return log;
  }

  getLogs(limit = 50): LogEntry[] {
    return this.logs.slice(0, limit);
  }
}

export const taskStore = new TaskStore();
