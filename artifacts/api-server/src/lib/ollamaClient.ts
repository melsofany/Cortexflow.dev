import axios from "axios";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
}

const PREFERRED_MODELS = ["deepseek-r1", "deepseek", "llama3", "llama2", "mistral", "phi3", "gemma", "qwen2", "qwen"];
const FALLBACK_MODEL = "qwen2:0.5b";

class OllamaClient {
  private baseUrl: string;
  private model: string;
  private available: boolean = false;
  private initialized: boolean = false;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.baseUrl = process.env.OLLAMA_URL || "http://localhost:11434";
    this.model = process.env.OLLAMA_MODEL || "llama3";
  }

  async initialize(): Promise<boolean> {
    try {
      const res = await axios.get(`${this.baseUrl}/api/tags`, { timeout: 5000 });
      const models: OllamaModel[] = res.data?.models || [];
      this.initialized = true;

      if (models.length === 0) {
        this.available = false;
        console.warn(`[Ollama] Server running but no models available — pulling ${FALLBACK_MODEL}...`);
        this.pullModelInBackground(FALLBACK_MODEL);
        this.scheduleRefresh();
        return false;
      }

      this.available = true;

      let matched = false;
      for (const name of PREFERRED_MODELS) {
        const found = models.find((m) => m.name.startsWith(name));
        if (found) {
          this.model = found.name;
          matched = true;
          break;
        }
      }
      if (!matched) {
        this.model = models[0].name;
      }

      console.log(`[Ollama] Connected. Model: ${this.model}. ${models.length} models available.`);

      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }

      return true;
    } catch {
      this.available = false;
      this.initialized = true;
      console.warn(`[Ollama] Not reachable at ${this.baseUrl}`);
      return false;
    }
  }

  private pullModelInBackground(modelName: string): void {
    axios.post(`${this.baseUrl}/api/pull`, { name: modelName }, { timeout: 10 * 60 * 1000 })
      .then(() => {
        console.log(`[Ollama] Model ${modelName} pulled successfully`);
        this.initialize();
      })
      .catch((err) => {
        console.warn(`[Ollama] Failed to pull ${modelName}:`, err.message);
      });
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(async () => {
      if (!this.available) {
        const ok = await this.initialize();
        if (ok) {
          console.log(`[Ollama] ✓ Models now available: ${this.model}`);
        }
      } else {
        if (this.refreshTimer) {
          clearInterval(this.refreshTimer);
          this.refreshTimer = null;
        }
      }
    }, 15000);
  }

  isAvailable(): boolean {
    return this.available;
  }

  getCurrentModel(): string {
    return this.model;
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await axios.get(`${this.baseUrl}/api/tags`, { timeout: 5000 });
      return (res.data?.models || []).map((m: OllamaModel) => m.name);
    } catch {
      return [];
    }
  }

  async chat(messages: ChatMessage[], options: { temperature?: number; max_tokens?: number; model?: string } = {}): Promise<string> {
    if (!this.available) throw new Error("Ollama not available");
    const modelToUse = options.model || this.model;
    const response = await axios.post(
      `${this.baseUrl}/api/chat`,
      {
        model: modelToUse,
        messages,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.4,
          num_predict: options.max_tokens ?? 800,
        },
      },
      { timeout: 120000 }
    );
    return response.data?.message?.content || "";
  }

  async generate(prompt: string, options: { temperature?: number; max_tokens?: number } = {}): Promise<string> {
    if (!this.available) throw new Error("Ollama not available");
    const response = await axios.post(
      `${this.baseUrl}/api/generate`,
      {
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.4,
          num_predict: options.max_tokens ?? 800,
        },
      },
      { timeout: 120000 }
    );
    return response.data?.response || "";
  }
}

export const ollamaClient = new OllamaClient();
