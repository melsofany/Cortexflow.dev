import { Router, type IRouter } from "express";
import axios from "axios";
import { isDeepSeekConfigured } from "../lib/deepseekClassifier.js";

const router: IRouter = Router();
const AGENT_SERVICE = process.env.AGENT_SERVICE_URL || "http://localhost:8090";

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
    res.json({
      models: { available: [], recommended: [] },
      providers: { providers: [], available_models: [] },
    });
  }
});

router.get("/providers/models", async (_req, res) => {
  try {
    const resp = await axios.get(`${AGENT_SERVICE}/health`, { timeout: 5000 });
    res.json({
      models:        resp.data.models,
      tools:         resp.data.tools,
      performance:   resp.data.performance,
      self_improvement: resp.data.self_improvement_report,
    });
  } catch {
    res.json({ models: [], tools: [], performance: {} });
  }
});

router.get("/providers/self-improvement", async (_req, res) => {
  try {
    const resp = await axios.get(`${AGENT_SERVICE}/self-improvement`, { timeout: 5000 });
    res.json(resp.data);
  } catch {
    res.json({ report: "خدمة الوكيل غير متاحة", stats: {}, suggestions: [] });
  }
});

router.post("/providers/execute", async (req, res) => {
  const { task, provider, model, task_type } = req.body;
  if (!task) {
    res.status(400).json({ error: "task is required" });
    return;
  }
  try {
    const resp = await axios.post(
      `${AGENT_SERVICE}/run`,
      { task, provider: provider || "auto", model: model || null, task_type: task_type || "" },
      { timeout: 300000 }
    );
    res.json(resp.data);
  } catch (err: any) {
    const msg = err.response?.data?.detail || err.message || "Execution failed";
    res.status(500).json({ error: msg });
  }
});

router.post("/providers/pull-model", async (req, res) => {
  const { model } = req.body;
  if (!model) {
    res.status(400).json({ error: "model name required" });
    return;
  }
  try {
    const resp = await axios.post(
      `${AGENT_SERVICE}/models/pull`,
      { model },
      { timeout: 10000 }
    );
    res.json(resp.data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/providers/tools", async (_req, res) => {
  try {
    const resp = await axios.get(`${AGENT_SERVICE}/tools`, { timeout: 5000 });
    res.json(resp.data);
  } catch {
    res.json({ tools: [] });
  }
});

router.get("/providers/classifier-status", (_req, res) => {
  res.json({
    deepseek: {
      configured: isDeepSeekConfigured(),
      model: "deepseek-chat",
      role: "task classifier",
      description: "يصنف المهام بدقة عالية في أقل من ثانية ثم يوجه لنموذج Ollama المناسب",
    },
  });
});

export default router;
