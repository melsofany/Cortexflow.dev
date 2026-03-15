import { Router, type IRouter } from "express";
import { ollamaClient } from "../lib/ollamaClient.js";
import { taskStore } from "../lib/taskStore.js";
import { AiChatBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/ai/models", async (_req, res) => {
  const available = await ollamaClient.listModels();
  res.json({
    activeProvider: ollamaClient.isAvailable() ? "ollama" : "none",
    ollamaAvailable: ollamaClient.isAvailable(),
    availableModels: available,
    currentModel: ollamaClient.getCurrentModel(),
  });
});

router.post("/ai/chat", async (req, res) => {
  const parsed = AiChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { messages, model, temperature } = parsed.data;
  const start = Date.now();

  if (!ollamaClient.isAvailable()) {
    const response = `I'm CortexFlow AI. Ollama is not running locally. Please install Ollama from https://ollama.ai and run: ollama pull llama3 — to enable real AI responses. I'm currently in simulation mode.`;
    res.json({ content: response, model: "simulation", provider: "simulation" });
    return;
  }

  try {
    const content = await ollamaClient.chat(
      messages.map((m) => ({ role: m.role, content: m.content })),
      {
        model: model ?? undefined,
        temperature: temperature ?? undefined,
      }
    );

    taskStore.addLog({
      agentType: "AI",
      action: "chat",
      input: messages[messages.length - 1]?.content?.substring(0, 100),
      output: content.substring(0, 200),
      durationMs: Date.now() - start,
    });

    res.json({ content, model: ollamaClient.getCurrentModel(), provider: "ollama" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
