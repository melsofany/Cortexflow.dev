import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import tasksRouter from "./tasks.js";
import aiRouter from "./ai.js";
import logsRouter from "./logs.js";
import providersRouter from "./providers.js";
import settingsRouter from "./settings.js";
import learningRouter from "./learning.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tasksRouter);
router.use(aiRouter);
router.use(logsRouter);
router.use(providersRouter);
router.use(settingsRouter);
router.use(learningRouter);

export default router;
