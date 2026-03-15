import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import tasksRouter from "./tasks.js";
import aiRouter from "./ai.js";
import logsRouter from "./logs.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tasksRouter);
router.use(aiRouter);
router.use(logsRouter);

export default router;
