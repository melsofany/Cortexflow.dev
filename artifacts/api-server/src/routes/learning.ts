import { Router, type IRouter } from "express";
import { learningEngine } from "../lib/learningEngine.js";
import { memorySystem } from "../lib/memory.js";
import { modelSelector } from "../lib/modelSelector.js";

const router: IRouter = Router();

router.get("/learning/stats", (_req, res) => {
  const stats = learningEngine.getStats();
  const memStats = memorySystem.getStats();
  const modelReport = modelSelector.getSelfImprovementReport();
  res.json({
    learning: stats,
    memory: memStats,
    modelImprovement: modelReport,
  });
});

router.get("/learning/data", (_req, res) => {
  const data = learningEngine.getAllData();
  res.json(data);
});

router.post("/learning/teach", (req, res) => {
  const { keyword, url, preference_key, preference_value } = req.body as {
    keyword?: string;
    url?: string;
    preference_key?: string;
    preference_value?: string;
  };
  if (keyword && url) {
    learningEngine.learnUrlMapping(keyword, url);
    res.json({ success: true, message: `تعلّمت: "${keyword}" → ${url}` });
    return;
  }
  if (preference_key && preference_value) {
    learningEngine.learnUserPreference(preference_key, preference_value);
    res.json({ success: true, message: `تعلّمت التفضيل: "${preference_key}" = "${preference_value}"` });
    return;
  }
  res.status(400).json({ success: false, error: "يرجى إرسال keyword+url أو preference_key+preference_value" });
});

router.delete("/learning/reset", (_req, res) => {
  learningEngine.resetLearning();
  res.json({ success: true, message: "تم مسح الذاكرة المتعلَّمة." });
});

export default router;
