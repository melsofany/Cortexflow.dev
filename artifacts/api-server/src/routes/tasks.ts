import { Router, type IRouter } from "express";
import { taskStore } from "../lib/taskStore.js";
import { agentRunner } from "../lib/agentRunner.js";
import { CreateTaskBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/tasks", (_req, res) => {
  const tasks = taskStore.getAllTasks();
  res.json(tasks);
});

router.post("/tasks", async (req, res) => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing required fields: description, type" });
    return;
  }
  const { description, type, url, priority } = parsed.data;
  const task = taskStore.createTask({ description, type, url: url ?? undefined, priority: priority ?? 0 });
  taskStore.addLog({ taskId: task.taskId, agentType: "API", action: "task_created", input: description });

  const io = (req as any).io;
  if (io) io.emit("taskCreated", task);

  res.json(task);
});

router.get("/tasks/:taskId", (req, res) => {
  const task = taskStore.getTask(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(task);
});

router.post("/tasks/:taskId/execute", async (req, res) => {
  const task = taskStore.getTask(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  if (task.status === "running") {
    res.json(task);
    return;
  }

  const io = (req as any).io;

  agentRunner.on("thinking", (data) => {
    if (io && data.taskId === task.taskId) io.emit("thinking", data);
  });
  agentRunner.on("taskSuccess", (data) => {
    if (io && data.taskId === task.taskId) io.emit("taskSuccess", data);
  });
  agentRunner.on("taskFail", (data) => {
    if (io && data.taskId === task.taskId) io.emit("taskFail", data);
  });
  agentRunner.on("taskStart", (data) => {
    if (io && data.taskId === task.taskId) io.emit("taskStart", data);
  });

  agentRunner.executeTask(task).catch(console.error);

  res.json({ ...task, status: "running" });
});

export default router;
