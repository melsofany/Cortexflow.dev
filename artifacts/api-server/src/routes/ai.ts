import { Router, type IRouter } from "express";
import axios from "axios";
import { ollamaClient } from "../lib/ollamaClient.js";
import { taskStore } from "../lib/taskStore.js";
import { AiChatBody } from "@workspace/api-zod";

const router: IRouter = Router();

const DEEPSEEK_URL   = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

const CORTEXFLOW_SYSTEM = `أنت CortexFlow، مساعد ذكاء اصطناعي متقدم على مستوى ChatGPT وDeepSeek.

قدراتك:
- الإجابة على جميع أنواع الأسئلة بعمق ودقة
- البرمجة والتحليل التقني
- البحث والكتابة والإبداع
- حل المشكلات خطوة بخطوة

معايير الجودة:
✅ قدّم إجابات شاملة ومفصّلة
✅ استخدم Markdown للتنسيق (عناوين، قوائم، كود، جداول)
✅ أضف أمثلة عملية عند الحاجة
✅ كن دقيقاً وواضحاً
✅ إجاباتك دائماً باللغة العربية`;

async function deepseekChat(messages: Array<{role: string; content: string}>, temperature = 0.4): Promise<string | null> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;
  try {
    const res = await axios.post(DEEPSEEK_URL, {
      model: DEEPSEEK_MODEL,
      messages,
      max_tokens: 3500,
      temperature,
    }, {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      timeout: 60000,
    });
    return res.data?.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  }
}

router.get("/ai/models", async (_req, res) => {
  const available = await ollamaClient.listModels();
  res.json({
    activeProvider: process.env.DEEPSEEK_API_KEY ? "deepseek" : ollamaClient.isAvailable() ? "ollama" : "none",
    ollamaAvailable: ollamaClient.isAvailable(),
    deepseekAvailable: !!process.env.DEEPSEEK_API_KEY,
    availableModels: available,
    currentModel: process.env.DEEPSEEK_API_KEY ? DEEPSEEK_MODEL : ollamaClient.getCurrentModel(),
  });
});

router.post("/ai/chat", async (req, res) => {
  const parsed = AiChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { messages, temperature } = parsed.data;
  const start = Date.now();

  const hasSystem = messages.length > 0 && messages[0].role === "system";
  const finalMessages = hasSystem
    ? messages
    : [{ role: "system", content: CORTEXFLOW_SYSTEM }, ...messages];

  const dsResult = await deepseekChat(finalMessages.map(m => ({ role: m.role, content: m.content })), temperature ?? 0.4);
  if (dsResult) {
    taskStore.addLog({
      agentType: "AI",
      action: "chat_deepseek",
      input: messages[messages.length - 1]?.content?.substring(0, 100),
      output: dsResult.substring(0, 200),
      durationMs: Date.now() - start,
    });
    res.json({ content: dsResult, model: DEEPSEEK_MODEL, provider: "deepseek" });
    return;
  }

  if (!ollamaClient.isAvailable()) {
    res.json({
      content: "خدمة الذكاء الاصطناعي غير متاحة حالياً. تحقق من اتصالك بالإنترنت أو تواصل مع الدعم.",
      model: "none",
      provider: "none"
    });
    return;
  }

  try {
    const content = await ollamaClient.chat(
      finalMessages.map((m) => ({ role: m.role, content: m.content })),
      { temperature: temperature ?? undefined }
    );

    taskStore.addLog({
      agentType: "AI",
      action: "chat_ollama",
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
