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
    }, 150);
  }

  private async captureAndEmit() {
    if (!this.page || !this.initialized) return;
    try {
      const screenshot = await this.page.screenshot({ type: "jpeg", quality: 70 });
      const base64 = screenshot.toString("base64");
      this.emit("screenshot", { image: base64 });
    } catch { }
  }

  async captureNow(): Promise<void> {
    await this.captureAndEmit();
  }

  async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");
    if (!url.startsWith("http")) url = "https://" + url;
    this.currentUrl = url;
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await this.page.waitForTimeout(1000);
  }

  async click(x: number, y: number): Promise<void> {
    if (!this.page) return;
    await this.page.mouse.click(x, y);
  }

  async clickByText(text: string): Promise<boolean> {
    if (!this.page) return false;
    try {
      const el = this.page.getByText(text, { exact: false }).first();
      await el.click({ timeout: 5000 });
      await this.page.waitForTimeout(1000);
      return true;
    } catch {
      try {
        await this.page.click(`text="${text}"`, { timeout: 5000 });
        await this.page.waitForTimeout(1000);
        return true;
      } catch {
        return false;
      }
    }
  }

  async clickBySelector(selector: string): Promise<boolean> {
    if (!this.page) return false;
    try {
      await this.page.click(selector, { timeout: 5000 });
      await this.page.waitForTimeout(1000);
      return true;
    } catch {
      return false;
    }
  }

  async fillField(selector: string, value: string): Promise<boolean> {
    if (!this.page) return false;
    try {
      const loc = this.page.locator(selector).first();
      await loc.waitFor({ state: "visible", timeout: 4000 });
      await loc.fill(value);
      return true;
    } catch {
      try {
        const loc = this.page.locator(selector).first();
        await loc.focus();
        await this.page.keyboard.type(value, { delay: 40 });
        return true;
      } catch {
        return false;
      }
    }
  }

  // ملء حقل بطريقة ذكية: يحاول التسمية / placeholder / name / id بالترتيب
  async smartFill(hint: string, value: string): Promise<boolean> {
    if (!this.page) return false;

    const tryFill = async (loc: import("playwright").Locator): Promise<boolean> => {
      try {
        await loc.first().waitFor({ state: "visible", timeout: 3000 });
        await loc.first().fill(value);
        return true;
      } catch { return false; }
    };

    // 1. Playwright getByLabel (يبحث في <label> المرتبطة)
    if (await tryFill(this.page.getByLabel(hint, { exact: false }))) return true;

    // 2. placeholder يحتوي على النص
    if (await tryFill(this.page.locator(`[placeholder*="${hint}"]`))) return true;

    // 3. name يطابق تماماً
    if (await tryFill(this.page.locator(`[name="${hint}"]`))) return true;

    // 4. name يحتوي على النص
    if (await tryFill(this.page.locator(`[name*="${hint}"]`))) return true;

    // 5. id يطابق
    if (await tryFill(this.page.locator(`[id="${hint}"]`))) return true;

    // 6. aria-label يحتوي على النص
    if (await tryFill(this.page.locator(`[aria-label*="${hint}"]`))) return true;

    // 7. بحث شامل عبر evaluate: يربط كل input بتسميته ثم يملأه
    try {
      const found = await this.page.evaluate(({ hint, value }) => {
        const h = hint.toLowerCase();
        for (const inp of Array.from(document.querySelectorAll<HTMLInputElement>("input, textarea"))) {
          const label = inp.labels?.[0]?.textContent?.toLowerCase() || "";
          const ph    = (inp.placeholder || "").toLowerCase();
          const nm    = (inp.name        || "").toLowerCase();
          const id    = (inp.id          || "").toLowerCase();
          if (label.includes(h) || ph.includes(h) || nm.includes(h) || id.includes(h)) {
            inp.focus();
            inp.value = value;
            inp.dispatchEvent(new Event("input",  { bubbles: true }));
            inp.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
        return false;
      }, { hint, value });
      if (found) return true;
    } catch { /* تجاهل */ }

    return false;
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

  async getPageStructure(): Promise<string> {
    if (!this.page) return "";
    try {
      const data = await this.page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input, textarea, select")).slice(0, 20).map((el: any) => ({
          tag: el.tagName.toLowerCase(),
          type: el.type || "",
          name: el.name || "",
          id: el.id || "",
          placeholder: el.placeholder || "",
          label: el.labels?.[0]?.textContent?.trim() || "",
        }));

        const buttons = Array.from(document.querySelectorAll("button, [role='button'], input[type='submit'], input[type='button'], a.btn, a[href]")).slice(0, 30).map((el: any) => ({
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim().slice(0, 60) || "",
          href: el.href || "",
          type: el.type || "",
        }));

        const title = document.title || "";
        const url = window.location.href;

        return { inputs, buttons, title, url };
      });

      const lines: string[] = [];
      lines.push(`الصفحة: ${data.title}`);
      lines.push(`URL: ${data.url}`);

      if (data.inputs.length > 0) {
        lines.push("\nحقول الإدخال (استخدم name= أو id= في أوامر fill):");
        data.inputs.forEach((inp: any) => {
          const visibleLabel = inp.label || inp.placeholder || "";
          const identifier   = inp.name ? `name="${inp.name}"` : (inp.id ? `id="${inp.id}"` : `type="${inp.type}"`);
          const fillKey      = inp.name || inp.id || inp.type;
          lines.push(`  - fill PARAM: ${fillKey}=<القيمة>  (${identifier}${visibleLabel ? `, تسمية: "${visibleLabel}"` : ""})`);
        });
      }

      if (data.buttons.length > 0) {
        lines.push("\nالأزرار والروابط:");
        data.buttons.forEach((btn: any) => {
          if (btn.text) lines.push(`  - [${btn.tag}] "${btn.text}" ${btn.href ? `-> ${btn.href}` : ""}`);
        });
      }

      return lines.join("\n");
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
        case "type_text":
          await this.page.keyboard.type(params.text || "", { delay: 30 });
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
