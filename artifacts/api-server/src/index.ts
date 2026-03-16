import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import app, { ollamaClient, agentRunner } from "./app.js";
import { taskStore, ConversationMessage } from "./lib/taskStore.js";
import { browserAgent } from "./lib/browserAgent.js";

const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);

const io = new SocketServer(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  path: "/api/socket",
  maxHttpBufferSize: 5e6,
});

app.use((req: any, _res: any, next: any) => {
  req.io = io;
  next();
});

// ── Browser screenshot streaming ─────────────────────────────────────────────
browserAgent.on("screenshot", (data: { image: string }) => {
  if (io.engine.clientsCount > 0) {
    io.emit("browserStream", data);
  }
});

// ── Track last completed task result for reconnect delivery ─────────────────
let lastCompletedTask: { taskId: string; result: string } | null = null;
let lastFailedTask:    { taskId: string; error: string }   | null = null;

// ── Conversation history per session (socket) ────────────────────────────────
const conversationStore = new Map<string, ConversationMessage[]>();
const MAX_CONVERSATION_HISTORY = 10;

// ── Socket.io connections ────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  // Send server status immediately on connect
  const tasks = taskStore.getAllTasks();
  const runningTask = tasks.find(t => t.status === "running");
  socket.emit("status", {
    tasks,
    logs: taskStore.getLogs(10),
    ollamaAvailable: ollamaClient.isAvailable(),
    activeModel: ollamaClient.getCurrentModel(),
    browserReady: browserAgent.isReady(),
    timestamp: new Date(),
  });

  // If a task just finished (within last 30s), re-deliver the result
  if (lastCompletedTask) {
    socket.emit("taskSuccess", lastCompletedTask);
    lastCompletedTask = null;
  }
  if (lastFailedTask) {
    socket.emit("taskFail", lastFailedTask);
    lastFailedTask = null;
  }

  // If a task is currently running, notify the client
  if (runningTask) {
    socket.emit("taskStart", {
      taskId: runningTask.taskId,
      description: runningTask.description,
      type: runningTask.type,
    });
  }

  // Initialize conversation history for new socket
  if (!conversationStore.has(socket.id)) {
    conversationStore.set(socket.id, []);
  }

  // ── Submit + execute task ─────────────────────────────────────────────────
  socket.on("submitTask", async (data) => {
    try {
      const sessionHistory = conversationStore.get(socket.id) || [];
      const userMessage = data.description || data.task || "";

      const task = taskStore.createTask({
        description: userMessage,
        type: data.type || "ai",
        url: data.url,
        priority: typeof data.priority === "number" ? data.priority : 0,
        conversationHistory: [...sessionHistory],
        sessionId: socket.id,
      });

      // Add user message to conversation history immediately
      sessionHistory.push({ role: "user", content: userMessage });
      if (sessionHistory.length > MAX_CONVERSATION_HISTORY * 2) {
        sessionHistory.splice(0, 2);
      }
      conversationStore.set(socket.id, sessionHistory);

      console.log(`[Task] Submitted: "${task.description}" (type=${task.type}, id=${task.taskId})`);

      io.emit("taskCreated", task);
      io.emit("taskUpdate", task);

      const onThinking      = (d: any) => { if (d.taskId === task.taskId) io.emit("thinking", d); };
      const onAgentActivity = (d: any) => { if (d.taskId === task.taskId) io.emit("agentActivity", d); };
      const onTaskPlan      = (d: any) => { if (d.taskId === task.taskId) io.emit("taskPlan", d); };
      const onStart = (d: any) => {
        if (d.taskId === task.taskId) {
          io.emit("taskStart", { ...d, type: task.type, description: task.description });
          io.emit("taskUpdate", taskStore.getTask(task.taskId));
        }
      };
      const onSuccess = (d: any) => {
        if (d.taskId === task.taskId) {
          console.log(`[Task] Completed: "${task.description}" → ${d.result?.substring(0, 80)}...`);
          lastCompletedTask = { taskId: d.taskId, result: d.result };
          // Add assistant response to conversation history
          const hist = conversationStore.get(socket.id) || [];
          if (d.result) {
            hist.push({ role: "assistant", content: d.result.substring(0, 500) });
            if (hist.length > MAX_CONVERSATION_HISTORY * 2) hist.splice(0, 2);
            conversationStore.set(socket.id, hist);
          }
          io.emit("taskSuccess", d);
          io.emit("taskUpdate", taskStore.getTask(task.taskId));
          cleanup();
        }
      };
      const onFail = (d: any) => {
        if (d.taskId === task.taskId) {
          console.log(`[Task] Failed: "${task.description}" → ${d.error || d.reason}`);
          lastFailedTask = { taskId: d.taskId, error: d.error || d.reason || "خطأ غير معروف" };
          // Add failure note to conversation history
          const hist = conversationStore.get(socket.id) || [];
          hist.push({ role: "assistant", content: `[فشلت المهمة: ${d.error || "خطأ غير معروف"}]` });
          if (hist.length > MAX_CONVERSATION_HISTORY * 2) hist.splice(0, 2);
          conversationStore.set(socket.id, hist);
          io.emit("taskFail", d);
          io.emit("taskUpdate", taskStore.getTask(task.taskId));
          cleanup();
        }
      };
      const onNeedInput = (d: any) => {
        if (d.taskId === task.taskId) io.emit("agentNeedsInput", d);
      };
      const onUserInput = (data: any) => {
        if (data.taskId === task.taskId) {
          agentRunner.emit(`userInput:${task.taskId}`, data.answer);
        }
      };
      const cleanup = () => {
        agentRunner.off("thinking",      onThinking);
        agentRunner.off("agentActivity", onAgentActivity);
        agentRunner.off("taskPlan",      onTaskPlan);
        agentRunner.off("taskStart",     onStart);
        agentRunner.off("taskSuccess",   onSuccess);
        agentRunner.off("taskFail",      onFail);
        agentRunner.off("needInput",     onNeedInput);
        socket.off("userInput", onUserInput);
      };

      agentRunner.on("thinking",      onThinking);
      agentRunner.on("agentActivity", onAgentActivity);
      agentRunner.on("taskPlan",      onTaskPlan);
      agentRunner.on("taskStart",     onStart);
      agentRunner.on("taskSuccess",   onSuccess);
      agentRunner.on("taskFail",      onFail);
      agentRunner.on("needInput",     onNeedInput);
      socket.on("userInput", onUserInput);

      agentRunner.executeTask(task).catch((err: any) => {
        console.error(`[Task] Execution error:`, err.message);
        io.emit("taskFail", { taskId: task.taskId, error: err.message });
        cleanup();
      });
    } catch (err: any) {
      socket.emit("error", { message: err.message });
    }
  });

  // ── Execute existing task ─────────────────────────────────────────────────
  socket.on("executeTask", async (taskId: string) => {
    const task = taskStore.getTask(taskId);
    if (!task) { socket.emit("error", { message: "Task not found" }); return; }
    if (task.status === "running") return;

    const onThinking = (d: any) => { if (d.taskId === taskId) io.emit("thinking", d); };
    const onStart    = (d: any) => { if (d.taskId === taskId) io.emit("taskStart", d); };
    const onSuccess  = (d: any) => {
      if (d.taskId === taskId) { io.emit("taskSuccess", d); io.emit("taskUpdate", taskStore.getTask(taskId)); cleanup(); }
    };
    const onFail = (d: any) => {
      if (d.taskId === taskId) { io.emit("taskFail", d); io.emit("taskUpdate", taskStore.getTask(taskId)); cleanup(); }
    };
    const cleanup = () => {
      agentRunner.off("thinking", onThinking);
      agentRunner.off("taskStart", onStart);
      agentRunner.off("taskSuccess", onSuccess);
      agentRunner.off("taskFail", onFail);
    };

    agentRunner.on("thinking", onThinking);
    agentRunner.on("taskStart", onStart);
    agentRunner.on("taskSuccess", onSuccess);
    agentRunner.on("taskFail", onFail);

    agentRunner.executeTask(task).catch(console.error);
  });

  // ── Browser events from user (click, type, navigate, etc.) ───────────────
  socket.on("browserEvent", async (data: { type: string; params: any }) => {
    if (!browserAgent.isReady()) {
      const ok = await browserAgent.initialize();
      if (!ok) return;
    }
    await browserAgent.handleEvent(data.type, data.params).catch((err: any) => {
      console.warn("[BrowserEvent] Error:", err.message);
    });
  });

  // ── Navigate URL (sent from address bar) ─────────────────────────────────
  socket.on("navigateTo", async (url: string) => {
    if (!browserAgent.isReady()) {
      await browserAgent.initialize().catch(() => {});
    }
    await browserAgent.navigate(url).catch((err: any) => {
      socket.emit("browserError", { message: err.message });
    });
  });

  // ── User Manual Browser Control (for captcha & real-time interaction) ─────
  socket.on("userMouseClick",  async (d: { x: number; y: number }) => {
    if (browserAgent.isReady()) await browserAgent.userClick(d.x, d.y).catch(() => {});
  });
  socket.on("userMouseDown",   async (d: { x: number; y: number }) => {
    if (browserAgent.isReady()) await browserAgent.userMouseDown(d.x, d.y).catch(() => {});
  });
  socket.on("userMouseUp",     async (d: { x: number; y: number }) => {
    if (browserAgent.isReady()) await browserAgent.userMouseUp(d.x, d.y).catch(() => {});
  });
  socket.on("userMouseMove",   async (d: { x: number; y: number }) => {
    if (browserAgent.isReady()) await browserAgent.userMouseMove(d.x, d.y).catch(() => {});
  });
  socket.on("userKeyDown",     async (d: { key: string }) => {
    if (browserAgent.isReady()) await browserAgent.userKeyDown(d.key).catch(() => {});
  });
  socket.on("userKeyUp",       async (d: { key: string }) => {
    if (browserAgent.isReady()) await browserAgent.userKeyUp(d.key).catch(() => {});
  });
  socket.on("userType",        async (d: { text: string }) => {
    if (browserAgent.isReady()) await browserAgent.userType(d.text).catch(() => {});
  });
  socket.on("userScroll",      async (d: { x: number; y: number; deltaX: number; deltaY: number }) => {
    if (browserAgent.isReady()) await browserAgent.userScroll(d.x, d.y, d.deltaX, d.deltaY).catch(() => {});
  });

  // ── Status ────────────────────────────────────────────────────────────────
  socket.on("getStatus", () => {
    socket.emit("status", {
      tasks: taskStore.getAllTasks(),
      logs: taskStore.getLogs(10),
      ollamaAvailable: ollamaClient.isAvailable(),
      activeModel: ollamaClient.getCurrentModel(),
      browserReady: browserAgent.isReady(),
      timestamp: new Date(),
    });
  });

  socket.on("resumeTask", async (taskId: string) => {
    const task = taskStore.getTask(taskId);
    if (!task) return;
    socket.emit("taskResumed", { taskId });
  });

  socket.on("stopTask", () => {
    taskStore.getAllTasks().forEach(t => {
      if (t.status === 'running' || t.status === 'pending') {
        taskStore.updateTask(t.taskId, { status: 'failed', error: 'أُوقفت من قِبل المستخدم' });
      }
    });
    io.emit("taskFail", { reason: 'stopped_by_user', error: 'أُوقفت من قِبل المستخدم' });
  });

  socket.on("disconnect", () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    // Keep conversation history for 30 minutes in case of reconnection
    setTimeout(() => conversationStore.delete(socket.id), 30 * 60 * 1000);
  });
});

async function startServer() {
  try {
    await ollamaClient.initialize();
  } catch {
    console.warn("[Server] Ollama init failed — running without local AI");
  }

  // ── Pre-initialize browser so it's ready before first task ───────────────
  browserAgent.initialize()
    .then((ok) => console.log(`[Server] Browser: ${ok ? "✓ Chromium ready" : "✗ not available"}`))
    .catch(() => console.warn("[Server] Browser init warning"));

  httpServer.listen(port, () => {
    console.log(`[Server] CortexFlow running on port ${port}`);
    console.log(`[Server] Ollama: ${ollamaClient.isAvailable() ? "✓ " + ollamaClient.getCurrentModel() : "✗ not available (simulation mode)"}`);
  });
}

startServer().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
