import { Router, type IRouter } from "express";
import axios from "axios";

const router: IRouter = Router();
const AGENT_SERVICE = "http://localhost:8090";

// List all providers with descriptions (LangGraph, AutoGPT, OpenInterpreter, Mistral, ...)
router.get("/providers", async (_req, res) => {
  try {
    const [modelsResp, providersResp] = await Promise.all([
      axios.get(`${AGENT_SERVICE}/models`,    { timeout: 5000 }),
      axios.get(`${AGENT_SERVICE}/providers`, { timeout: 5000 }),
    ]);
    res.json({
      models:    modelsResp.data,
      providers: providersResp.data,
    });
  } catch {
    res.status(503).json({ error: "Agent service unavailable" });
  }
});

// List installed Ollama models + available providers
router.get("/providers/models", async (_req, res) => {
  try {
    const resp = await axios.get(`${AGENT_SERVICE}/health`, { timeout: 5000 });
    res.json({
      models:       resp.data.available_models,
      providers:    resp.data.providers,
      integrations: resp.data.integrations,
    });
  } catch {
    res.status(503).json({ error: "Agent service unavailable" });
  }
});

// Execute task via a specific provider
// Providers: LangGraph | AutoGPT | OpenInterpreter | mistralai | QwenLM | meta-llama
router.post("/providers/execute", async (req, res) => {
  const { task, provider, model } = req.body;
  if (!task) {
    res.status(400).json({ error: "task is required" });
    return;
  }
  try {
    const resp = await axios.post(
      `${AGENT_SERVICE}/execute`,
      { task, provider: provider || "LangGraph", model },
      { timeout: 300000 }
    );
    res.json(resp.data);
  } catch (err: any) {
    const msg = err.response?.data?.detail || err.message || "Execution failed";
    res.status(500).json({ error: msg });
  }
});

// Pull a new Ollama model (streaming)
router.post("/providers/pull-model", async (req, res) => {
  const { model } = req.body;
  if (!model) {
    res.status(400).json({ error: "model name required" });
    return;
  }
  try {
    const resp = await axios.post(
      `${AGENT_SERVICE}/pull-model`,
      { model },
      { responseType: "stream", timeout: 600000 }
    );
    res.setHeader("Content-Type", "text/plain");
    resp.data.pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
