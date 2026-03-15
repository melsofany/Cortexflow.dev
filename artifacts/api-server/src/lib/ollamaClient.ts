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

class OllamaClient {
  private baseUrl: string;
  private model: string;
  private available: boolean = false;
  private initialized: boolean = false;

  constructor() {
    this.baseUrl = process.env.OLLAMA_URL || "http://localhost:11434";
    this.model = process.env.OLLAMA_MODEL || "llama3";
  }

  async initialize(): Promise<boolean> {
    try {
      const res = await axios.get(`${this.baseUrl}/api/tags`, { timeout: 3000 });
      const models: OllamaModel[] = res.data?.models || [];
      this.available = true;
      this.initialized = true;

      const preferred = ["deepseek-r1", "llama3", "llama2", "mistral", "qwen2", "qwen", "phi3", "gemma"];
      for (const name of preferred) {
        const found = models.find((m) => m.name.startsWith(name));
        if (found) {
          this.model = found.name;
          break;
        }
      }
      if (models.length > 0 && !this.model) {
        this.model = models[0].name;
      }
      console.log(`[Ollama] Connected. Model: ${this.model}. ${models.length} models available.`);
      return true;
    } catch {
      this.available = false;
      this.initialized = true;
      console.warn(`[Ollama] Not reachable at ${this.baseUrl}`);
      return false;
    }
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
    const response = await axios.post(
      `${this.baseUrl}/api/chat`,
      {
        model: options.model || this.model,
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
