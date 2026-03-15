import { chromium, Browser, BrowserContext, Page } from "playwright";
import { EventEmitter } from "events";

const CHROMIUM_PATH = "/nix/store/0n9rl5l9syy808xi9bk4f6dhnfrvhkww-playwright-browsers-chromium/chromium-1080/chrome-linux/chrome";

class BrowserAgent extends EventEmitter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private streamInterval: ReturnType<typeof setInterval> | null = null;
  private initialized = false;
  private currentUrl = "";

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;
    try {
      this.browser = await chromium.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
          "--disable-extensions",
        ],
      });
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        locale: "ar-SA",
      });
      this.page = await this.context.newPage();
      await this.page.goto("about:blank");
      this.initialized = true;
      console.log("[BrowserAgent] Chromium initialized successfully");
      this.startStreaming();
      return true;
    } catch (err: any) {
      console.error("[BrowserAgent] Failed to init Chromium:", err.message);
      return false;
    }
  }

  private startStreaming() {
    if (this.streamInterval) clearInterval(this.streamInterval);
    this.streamInterval = setInterval(async () => {
      await this.captureAndEmit();
    }, 500);
  }

  private async captureAndEmit() {
    if (!this.page || !this.initialized) return;
    try {
      const screenshot = await this.page.screenshot({ type: "jpeg", quality: 60 });
      const base64 = screenshot.toString("base64");
      this.emit("screenshot", { image: base64 });
    } catch { }
  }

  async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");
    if (!url.startsWith("http")) url = "https://" + url;
    this.currentUrl = url;
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  }

  async click(x: number, y: number): Promise<void> {
    if (!this.page) return;
    await this.page.mouse.click(x, y);
  }

  async type(text: string): Promise<void> {
    if (!this.page) return;
    await this.page.keyboard.type(text, { delay: 50 });
  }

  async pressKey(key: string): Promise<void> {
    if (!this.page) return;
    await this.page.keyboard.press(key);
  }

  async scroll(deltaX: number, deltaY: number): Promise<void> {
    if (!this.page) return;
    await this.page.mouse.wheel(deltaX, deltaY);
  }

  async goBack(): Promise<void> {
    if (!this.page) return;
    await this.page.goBack({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
  }

  async goForward(): Promise<void> {
    if (!this.page) return;
    await this.page.goForward({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
  }

  async reload(): Promise<void> {
    if (!this.page) return;
    await this.page.reload({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
  }

  async getPageContent(): Promise<string> {
    if (!this.page) return "";
    try {
      return await this.page.evaluate("document.body?.innerText?.slice(0, 3000) || ''") as string;
    } catch { return ""; }
  }

  async getCurrentUrl(): Promise<string> {
    if (!this.page) return "";
    try { return this.page.url(); } catch { return ""; }
  }

  async handleEvent(type: string, params: any): Promise<void> {
    if (!this.page) return;
    try {
      switch (type) {
        case "click":
          await this.page.mouse.click(params.x, params.y, { button: params.button || "left" });
          break;
        case "dblclick":
          await this.page.mouse.dblclick(params.x, params.y);
          break;
        case "contextmenu":
          await this.page.mouse.click(params.x, params.y, { button: "right" });
          break;
        case "move":
          await this.page.mouse.move(params.x, params.y);
          break;
        case "mousedown":
          await this.page.mouse.down({ button: params.button || "left" });
          break;
        case "mouseup":
          await this.page.mouse.up({ button: params.button || "left" });
          break;
        case "keydown":
          await this.page.keyboard.down(params.key);
          break;
        case "keyup":
          await this.page.keyboard.up(params.key);
          break;
        case "type":
          await this.page.keyboard.type(params.text, { delay: 30 });
          break;
        case "wheel":
          await this.page.mouse.wheel(params.deltaX || 0, params.deltaY || 0);
          break;
        case "navigate":
          await this.navigate(params.url);
          break;
        case "go_back":
          await this.goBack();
          break;
        case "go_forward":
          await this.goForward();
          break;
        case "reload":
          await this.reload();
          break;
      }
    } catch (err: any) {
      console.warn(`[BrowserAgent] Event error (${type}):`, err.message);
    }
  }

  isReady(): boolean {
    return this.initialized && this.page !== null;
  }

  async close(): Promise<void> {
    if (this.streamInterval) clearInterval(this.streamInterval);
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.page = null;
    this.context = null;
    this.initialized = false;
  }
}

export const browserAgent = new BrowserAgent();
