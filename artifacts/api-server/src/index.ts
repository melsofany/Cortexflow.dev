import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import app, { ollamaClient, agentRunner } from "./app.js";
import { taskStore } from "./lib/taskStore.js";

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
});

app.use((req: any, _res, next) => {
  req.io = io;
  next();
});

io.on("connection", (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  socket.on("submitTask", async (data) => {
    try {
      const task = taskStore.createTask(data);
      socket.emit("taskCreated", task);
      io.emit("taskUpdate", task);
    } catch (err: any) {
      socket.emit("error", { message: err.message });
    }
  });

  socket.on("executeTask", async (taskId: string) => {
    const task = taskStore.getTask(taskId);
    if (!task) {
      socket.emit("error", { message: "Task not found" });
      return;
    }

    agentRunner.on("thinking", (data) => {
      if (data.taskId === taskId) socket.emit("thinking", data);
    });
    agentRunner.on("taskSuccess", (data) => {
      if (data.taskId === taskId) {
        socket.emit("taskSuccess", data);
        io.emit("taskUpdate", taskStore.getTask(taskId));
      }
    });
    agentRunner.on("taskFail", (data) => {
      if (data.taskId === taskId) {
        socket.emit("taskFail", data);
        io.emit("taskUpdate", taskStore.getTask(taskId));
      }
    });
    agentRunner.on("taskStart", (data) => {
      if (data.taskId === taskId) socket.emit("taskStart", data);
    });

    agentRunner.executeTask(task).catch(console.error);
  });

  socket.on("getStatus", () => {
    const tasks = taskStore.getAllTasks();
    const logs = taskStore.getLogs(10);
    socket.emit("status", {
      tasks,
      logs,
      ollamaAvailable: ollamaClient.isAvailable(),
      activeModel: ollamaClient.getCurrentModel(),
      timestamp: new Date(),
    });
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

  httpServer.listen(port, () => {
    console.log(`[Server] CortexFlow running on port ${port}`);
    console.log(`[Server] Ollama: ${ollamaClient.isAvailable() ? "✓ " + ollamaClient.getCurrentModel() : "✗ not available"}`);
  });
}

startServer().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
