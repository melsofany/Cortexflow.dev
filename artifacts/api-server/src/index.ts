import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import app, { ollamaClient, agentRunner } from "./app.js";
import { taskStore } from "./lib/taskStore.js";
import { browserAgent } from "./lib/browserAgent.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

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

// ── Socket.io connections ────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  // ── Submit + execute task ─────────────────────────────────────────────────
  socket.on("submitTask", async (data) => {
    try {
      const task = taskStore.createTask({
        description: data.description || data.task || "",
        type: data.type || "browser",
        url: data.url,
        priority: typeof data.priority === "number" ? data.priority : 0,
      });

      socket.emit("taskCreated", task);
      io.emit("taskUpdate", task);

      const onThinking = (d: any) => {
        if (d.taskId === task.taskId) socket.emit("thinking", d);
      };
      const onStart = (d: any) => {
        if (d.taskId === task.taskId) {
          socket.emit("taskStart", d);
          io.emit("taskUpdate", taskStore.getTask(task.taskId));
        }
      };
      const onSuccess = (d: any) => {
        if (d.taskId === task.taskId) {
          socket.emit("taskSuccess", d);
          io.emit("taskUpdate", taskStore.getTask(task.taskId));
          cleanup();
        }
      };
      const onFail = (d: any) => {
        if (d.taskId === task.taskId) {
          socket.emit("taskFail", d);
          io.emit("taskUpdate", taskStore.getTask(task.taskId));
          cleanup();
        }
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

      agentRunner.executeTask(task).catch((err: any) => {
        socket.emit("error", { message: err.message });
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

    const onThinking = (d: any) => { if (d.taskId === taskId) socket.emit("thinking", d); };
    const onStart    = (d: any) => { if (d.taskId === taskId) socket.emit("taskStart", d); };
    const onSuccess  = (d: any) => {
      if (d.taskId === taskId) { socket.emit("taskSuccess", d); io.emit("taskUpdate", taskStore.getTask(taskId)); cleanup(); }
    };
    const onFail = (d: any) => {
      if (d.taskId === taskId) { socket.emit("taskFail", d); io.emit("taskUpdate", taskStore.getTask(taskId)); cleanup(); }
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

  // ── Status ────────────────────────────────────────────────────────────────
  socket.on("getStatus", () => {
    const tasks = taskStore.getAllTasks();
    const logs  = taskStore.getLogs(10);
    socket.emit("status", {
      tasks,
      logs,
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

  socket.on("disconnect", () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
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
