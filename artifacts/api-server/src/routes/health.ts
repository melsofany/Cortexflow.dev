import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { ollamaClient } from "../lib/ollamaClient.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    ollamaAvailable: ollamaClient.isAvailable(),
    activeModel: ollamaClient.getCurrentModel(),
  });
  res.json(data);
});

export default router;
