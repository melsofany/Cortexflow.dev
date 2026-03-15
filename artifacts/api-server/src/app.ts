import express, { type Express } from "express";
import cors from "cors";
import router from "./routes/index.js";
import { ollamaClient } from "./lib/ollamaClient.js";
import { agentRunner } from "./lib/agentRunner.js";

const app: Express = express();

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export { ollamaClient, agentRunner };
export default app;
