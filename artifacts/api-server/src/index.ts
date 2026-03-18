import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import app, { ollamaClient, agentRunner } from "./app.js";
import { taskStore, ConversationMessage } from "./lib/taskStore.js";
import { browserAgent } from "./lib/browserAgent.js";
import { techIntelligence } from "./lib/techIntelligence.js";

const IS_CLOUD = process.env.NODE_ENV === "production" || !!process.env.RENDER;
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

// ── Track pending user-input request so it can be re-sent on reconnect ───────
let pendingInputRequest: { taskId: string; question: string } | null = null;

// Forward needInput to the global tracker
agentRunner.on("needInput", (d: { taskId: string; question: string }) => {
  pendingInputRequest = d;
});
// Clear tracker when task finishes
agentRunner.on("taskSuccess", (d: { taskId: string }) => {
  if (pendingInputRequest?.taskId === d.taskId) pendingInputRequest = null;
});
agentRunner.on("taskFail", (d: { taskId: string }) => {
  if (pendingInputRequest?.taskId === d.taskId) pendingInputRequest = null;
});

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
    isCloud: IS_CLOUD,
    timestamp: new Date(),
  });

  // إرسال بيانات التقنية فوراً عند الاتصال
  socket.emit("techUpdate", {
    performance: techIntelligence.monitor.getLatestSnapshot(),
    pendingImprovements: techIntelligence.improver.getPending().length,
    apiHealth: techIntelligence.monitor.getData().apiHealth,
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

  // ── Re-deliver pending input request on reconnect ────────────────────────
  if (pendingInputRequest) {
    socket.emit("agentNeedsInput", pendingInputRequest);
    console.log(`[Socket.io] Re-delivered pending input request to ${socket.id}: "${pendingInputRequest.question.substring(0, 60)}"`);
  }

  // ── Global userInput listener — forwards from ANY socket to agentRunner ──
  // This ensures reconnected clients can answer pending input requests
  socket.on("userInput", (data: { taskId: string; answer: string }) => {
    if (data.taskId && data.answer !== undefined) {
      agentRunner.emit(`userInput:${data.taskId}`, data.answer);
      if (pendingInputRequest?.taskId === data.taskId) {
        pendingInputRequest = null;
      }
      console.log(`[Socket.io] userInput received from ${socket.id} for task ${data.taskId}`);
    }
  });

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
      const onAgentToken    = (d: any) => { if (d.taskId === task.taskId) io.emit("agentToken", d); };
      const onMemoryStore   = (d: any) => { if (d.taskId === task.taskId) io.emit("memoryStore", d); };
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
      const cleanup = () => {
        agentRunner.off("thinking",      onThinking);
        agentRunner.off("agentActivity", onAgentActivity);
        agentRunner.off("taskPlan",      onTaskPlan);
        agentRunner.off("agentToken",    onAgentToken);
        agentRunner.off("memoryStore",   onMemoryStore);
        agentRunner.off("taskStart",     onStart);
        agentRunner.off("taskSuccess",   onSuccess);
        agentRunner.off("taskFail",      onFail);
        agentRunner.off("needInput",     onNeedInput);
      };

      agentRunner.on("thinking",      onThinking);
      agentRunner.on("agentActivity", onAgentActivity);
      agentRunner.on("taskPlan",      onTaskPlan);
      agentRunner.on("agentToken",    onAgentToken);
      agentRunner.on("memoryStore",   onMemoryStore);
      agentRunner.on("taskStart",     onStart);
      agentRunner.on("taskSuccess",   onSuccess);
      agentRunner.on("taskFail",      onFail);
      agentRunner.on("needInput",     onNeedInput);

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
  socket.on("solveCaptchaAuto", async () => {
    if (!browserAgent.isReady()) { socket.emit("agentLog", { type: "warn", text: "المتصفح غير جاهز" }); return; }
    await browserAgent.solveCaptchaAuto((event, data) => socket.emit(event, data));
  });

  socket.on("userMouseDown",   async (d: { x: number; y: number }) => {
    console.log(`[click] x=${d.x} y=${d.y}`);
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

  // ── Helper: broadcast health update to all connected clients ────────────
  const broadcastHealth = () => {
    io.emit("techUpdate", {
      performance: techIntelligence.monitor.getLatestSnapshot(),
      pendingImprovements: techIntelligence.improver.getPending().length,
      apiHealth: techIntelligence.monitor.getData().apiHealth,
    });
  };

  // ── Pre-initialize browser so it's ready before first task ───────────────
  browserAgent.initialize()
    .then((ok) => {
      console.log(`[Server] Browser: ${ok ? "✓ Chromium ready" : "✗ not available"}`);
      techIntelligence.monitor.setBrowserHealth(ok);
      broadcastHealth();
      // في السحابة: إعادة المحاولة مرة واحدة بعد 30 ثانية إذا فشل
      if (!ok && IS_CLOUD) {
        setTimeout(() => {
          console.log("[Server] Browser: إعادة محاولة تشغيل Chromium...");
          browserAgent.initialize().then((ok2) => {
            console.log(`[Server] Browser retry: ${ok2 ? "✓ نجح" : "✗ فشل"}`);
            techIntelligence.monitor.setBrowserHealth(ok2);
            broadcastHealth();
          }).catch((e2) => {
            console.error("[Server] Browser retry error:", String(e2));
          });
        }, 30000);
      }
    })
    .catch((err) => {
      console.error("[Server] Browser init error:", String(err));
      techIntelligence.monitor.setBrowserHealth(false);
      broadcastHealth();
    });

  // ── Tech Intelligence: بحث، تطوير ذاتي، مراقبة ────────────────────────
  techIntelligence.startBackgroundJobs();

  // ── إرسال تحديث بعد الفحص الأولي (يتم بعد 5 ثوانٍ) ──────────────────
  setTimeout(() => broadcastHealth(), 8 * 1000);

  // ── Keep Agent Service alive on Render starter (spin-down prevention) ───
  if (IS_CLOUD) {
    const AGENT_SERVICE = process.env.AGENT_SERVICE_URL || "http://localhost:8090";
    const { default: axios } = await import("axios");
    setInterval(async () => {
      try {
        await axios.get(`${AGENT_SERVICE}/health`, { timeout: 10000 });
        console.log("[KeepAlive] Agent Service ping OK");
      } catch {
        console.log("[KeepAlive] Agent Service ping failed (may be sleeping)");
      }
    }, 10 * 60 * 1000); // كل 10 دقائق
    console.log("[KeepAlive] Agent Service keep-alive enabled");
  }

  // ── إرسال تحديثات التقنية عبر Socket.io ───────────────────────────────
  setInterval(() => {
    if (io.engine.clientsCount > 0) broadcastHealth();
  }, 15 * 1000); // كل 15 ثانية

  httpServer.listen(port, () => {
    console.log(`[Server] CortexFlow running on port ${port}`);
    console.log(`[Server] Ollama: ${ollamaClient.isAvailable() ? "✓ " + ollamaClient.getCurrentModel() : "✗ not available (simulation mode)"}`);
    console.log(`[Server] Tech Intelligence: ✓ بحث + تطوير ذاتي + مراقبة`);
  });
}

startServer().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
