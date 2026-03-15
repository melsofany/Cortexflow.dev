import axios from "axios";
import { TaskCategory } from "./modelSelector.js";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

const CLASSIFY_PROMPT = `You are a task classifier for an AI agent system. Classify the user's task into EXACTLY ONE of these categories:

- browser    → web browsing, visiting sites, clicking, filling forms, logging in, navigating
- code       → programming, writing scripts, debugging, APIs, databases, functions
- research   → searching info, explaining concepts, summarizing, analyzing data
- creative   → writing stories, articles, poems, marketing copy, dialogues
- math       → calculations, equations, statistics, numerical problems
- translation → translating text between languages
- reasoning  → complex logic, comparisons, strategic planning, decision making
- file       → reading/writing files, parsing data files (json/csv/txt)
- agent      → multi-step goal completion, complex projects requiring planning
- simple     → short casual questions, greetings, basic lookups

Respond with ONLY the category name in lowercase, nothing else. No explanation.`;

let deepseekAvailable: boolean | null = null;
let lastCheck = 0;

async function checkDeepSeekAvailable(): Promise<boolean> {
  const now = Date.now();
  if (deepseekAvailable !== null && now - lastCheck < 60000) {
    return deepseekAvailable;
  }
  if (!DEEPSEEK_API_KEY) {
    deepseekAvailable = false;
    return false;
  }
  try {
    const res = await axios.get(`${DEEPSEEK_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
      timeout: 3000,
    });
    deepseekAvailable = res.status === 200;
  } catch {
    deepseekAvailable = false;
  }
  lastCheck = now;
  return deepseekAvailable;
}

export async function classifyWithDeepSeek(
  taskDescription: string
): Promise<{ category: TaskCategory; confidence: "high" | "low"; source: "deepseek" | "fallback" }> {
  const available = await checkDeepSeekAvailable();

  if (!available) {
    return { category: "simple", confidence: "low", source: "fallback" };
  }

  try {
    const response = await axios.post(
      `${DEEPSEEK_BASE_URL}/chat/completions`,
      {
        model: "deepseek-chat",
        messages: [
          { role: "system", content: CLASSIFY_PROMPT },
          { role: "user", content: taskDescription },
        ],
        max_tokens: 10,
        temperature: 0,
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 5000,
      }
    );

    const raw = response.data?.choices?.[0]?.message?.content?.trim().toLowerCase() ?? "";

    const validCategories: TaskCategory[] = [
      "browser", "code", "research", "creative", "math",
      "translation", "reasoning", "file", "agent", "simple",
    ];

    const matched = validCategories.find(c => raw.includes(c));

    if (matched) {
      console.log(`[DeepSeek] Classified "${taskDescription.slice(0, 50)}" → ${matched}`);
      return { category: matched, confidence: "high", source: "deepseek" };
    }

    console.warn(`[DeepSeek] Unexpected response: "${raw}" — falling back`);
    return { category: "simple", confidence: "low", source: "fallback" };

  } catch (err: any) {
    console.warn(`[DeepSeek] Classification error: ${err.message}`);
    deepseekAvailable = false;
    lastCheck = Date.now();
    return { category: "simple", confidence: "low", source: "fallback" };
  }
}

export function isDeepSeekConfigured(): boolean {
  return !!DEEPSEEK_API_KEY;
}

export { DEEPSEEK_API_KEY };
