import { Router, type IRouter } from "express";
import { taskStore } from "../lib/taskStore.js";

const router: IRouter = Router();

router.get("/logs", (req, res) => {
  const limit = parseInt(String(req.query.limit || "50"), 10);
  const logs = taskStore.getLogs(Math.min(limit, 200));
  res.json(logs);
});

export default router;
