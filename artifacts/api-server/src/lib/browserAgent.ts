import { chromium, Browser, BrowserContext, Page } from "playwright";
import { solveCaptcha } from "./captchaSolver";
import { EventEmitter } from "events";
import { existsSync } from "fs";

const REPLIT_CHROMIUM_PATH = "/nix/store/0n9rl5l9syy808xi9bk4f6dhnfrvhkww-playwright-browsers-chromium/chromium-1080/chrome-linux/chrome";
const SYSTEM_CHROMIUM_PATHS = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  REPLIT_CHROMIUM_PATH,
];
const CHROMIUM_PATH = SYSTEM_CHROMIUM_PATHS.find(p => p && existsSync(p)) || undefined;

class BrowserAgent extends EventEmitter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private streamInterval: ReturnType<typeof setInterval> | null = null;
  private initialized = false;
  private currentUrl = "";
  private capturing = false;

  private async applyStealthPatches(): Promise<void> {
    if (!this.context) return;
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 2 },
        ],
      });
      Object.defineProperty(navigator, 'languages', { get: () => ['ar-SA', 'ar', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      (window as any).chrome = {
        app: { isInstalled: false },
        runtime: {
          onConnect: { addListener: () => {} },
          onMessage: { addListener: () => {} },
        },
      };
      const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
      window.navigator.permissions.query = (params: any) =>
        (params.name === 'notifications') ? Promise.resolve({ state: 'denied' } as any) : originalQuery(params);
    });
  }

  async initialize(): Promise<boolean> {
    if (this.initialized) return true;
    try {
      this.browser = await chromium.launch({
        ...(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {}),
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
          "--disable-blink-features=AutomationControlled",
          "--disable-features=IsolateOrigins,site-per-process",
          "--disable-site-isolation-trials",
          "--flag-switches-begin",
          "--disable-site-isolation-trials",
          "--flag-switches-end",
          "--disable-web-security",
          "--allow-running-insecure-content",
          "--disable-extensions",
        ],
      });
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        locale: "ar-SA",
        extraHTTPHeaders: {
          "Accept-Language": "ar-SA,ar;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });
      await this.applyStealthPatches();
      this.page = await this.context.newPage();
      await this.page.goto("about:blank");
      this.initialized = true;
      console.log("[BrowserAgent] Chromium initialized with stealth mode");
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
    }, 50);
  }

  private async captureAndEmit() {
    if (!this.page || !this.initialized || this.capturing) return;
    this.capturing = true;
    try {
      const screenshot = await this.page.screenshot({ type: "jpeg", quality: 60 });
      const base64 = screenshot.toString("base64");
      const url = this.currentUrl || await this.page.url().catch(() => "");
      this.emit("screenshot", { image: base64, url });
    } catch { } finally {
      this.capturing = false;
    }
  }

  async captureNow(): Promise<void> {
    await this.captureAndEmit();
  }

  async userClick(x: number, y: number): Promise<void> {
    if (!this.page) return;
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.mouse.up();
    await this.captureAndEmit();
  }

  async userMouseMove(x: number, y: number): Promise<void> {
    if (!this.page) return;
    await this.page.mouse.move(x, y);
  }

  async userMouseDown(x: number, y: number): Promise<void> {
    if (!this.page) return;
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.captureAndEmit();
  }

  async userMouseUp(x: number, y: number): Promise<void> {
    if (!this.page) return;
    await this.page.mouse.up();
    await this.captureAndEmit();
  }

  async userKeyDown(key: string): Promise<void> {
    if (!this.page) return;
    await this.page.keyboard.down(key);
    await this.captureAndEmit();
  }

  async userKeyUp(key: string): Promise<void> {
    if (!this.page) return;
    await this.page.keyboard.up(key);
  }

  async userType(text: string): Promise<void> {
    if (!this.page) return;
    await this.page.keyboard.type(text, { delay: 0 });
    await this.captureAndEmit();
  }

  async userScroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    if (!this.page) return;
    await this.page.mouse.move(x, y);
    await this.page.mouse.wheel(deltaX, deltaY);
    await this.captureAndEmit();
  }

  async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");
    if (!url.startsWith("http")) url = "https://" + url;
    this.currentUrl = url;
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await this.page.waitForTimeout(1000);
  }

  async detectCaptcha(): Promise<{ found: boolean; siteKey?: string; pageUrl?: string; type?: string }> {
    if (!this.page) return { found: false };
    try {
      const pageUrl = this.page.url();
      // Check frames for reCAPTCHA
      const frames = this.page.frames();
      for (const frame of frames) {
        const furl = frame.url();
        if (furl.includes("recaptcha") || furl.includes("fbsbx.com/captcha")) {
          // Extract sitekey from iframe URL (?k=SITEKEY or &k=SITEKEY)
          const kMatch = furl.match(/[?&]k=([^&]+)/);
          const siteKey = kMatch ? kMatch[1] : undefined;
          return { found: true, siteKey, pageUrl, type: "recaptcha-v2" };
        }
      }
      // Check main page for data-sitekey
      const siteKey = await this.page.evaluate(() => {
        const el = document.querySelector('[data-sitekey]') as HTMLElement | null;
        return el?.getAttribute('data-sitekey') || null;
      }).catch(() => null);
      if (siteKey) return { found: true, siteKey, pageUrl, type: "recaptcha-v2" };
      // Check for hCaptcha
      const hSiteKey = await this.page.evaluate(() => {
        const el = document.querySelector('[data-hcaptcha-widget-id],[class*="h-captcha"]') as HTMLElement | null;
        return el?.getAttribute('data-sitekey') || null;
      }).catch(() => null);
      if (hSiteKey) return { found: true, siteKey: hSiteKey, pageUrl, type: "hcaptcha" };
      return { found: false };
    } catch {
      return { found: false };
    }
  }

  async solveCaptchaAuto(emit?: (event: string, data: any) => void): Promise<boolean> {
    const detection = await this.detectCaptcha();
    if (!detection.found) {
      console.log("[BrowserAgent] No captcha detected");
      return false;
    }
    if (!detection.siteKey) {
      console.log("[BrowserAgent] Captcha found but no sitekey extracted");
      emit?.("agentLog", { type: "warn", text: "⚠️ كابتشا مكتشف لكن لا يمكن استخراج المفتاح — حاول الحل يدوياً" });
      return false;
    }
    console.log(`[BrowserAgent] Captcha: type=${detection.type} sitekey=${detection.siteKey?.slice(0,12)}...`);
    emit?.("agentLog", { type: "info", text: `🔐 جارٍ حل الكابتشا تلقائياً (${detection.type})...` });
    const token = await solveCaptcha(detection.siteKey, detection.pageUrl || this.page!.url());
    if (!token) {
      emit?.("agentLog", { type: "warn", text: "⚠️ لم يتم حل الكابتشا. تأكد من ضبط TWO_CAPTCHA_API_KEY أو CAPSOLVER_API_KEY" });
      return false;
    }
    // Inject token into page
    if (!this.page) return false;
    await this.page.evaluate((t: string) => {
      const areas = document.querySelectorAll('textarea[name="g-recaptcha-response"], #g-recaptcha-response');
      areas.forEach((el: any) => { el.value = t; el.style.display = 'block'; });
      try {
        const callbacks = Object.values((window as any).___grecaptcha_cfg?.clients || {});
        for (const c of callbacks as any[]) {
          const fn = c?.aa?.l?.callback || c?.callback;
          if (typeof fn === "function") { fn(t); break; }
        }
      } catch {}
    }, token);
    await this.page.waitForTimeout(2000);
    await this.captureAndEmit();
    emit?.("agentLog", { type: "success", text: "✅ تم حقن رمز الكابتشا بنجاح" });
    return true;
  }

  async click(x: number, y: number): Promise<void> {
    if (!this.page) return;
    await this.page.mouse.click(x, y);
  }

  async clickByText(text: string): Promise<boolean> {
    if (!this.page) return false;

    const tryClick = async (loc: import("playwright").Locator): Promise<boolean> => {
      try {
        await loc.first().waitFor({ state: "visible", timeout: 3000 });
        await loc.first().click({ timeout: 4000 });
        await this.page!.waitForTimeout(1200);
        return true;
      } catch { return false; }
    };

    // ابحث في كل الإطارات (الرئيسي + iframes)
    const frames = [this.page.mainFrame(), ...this.page.frames().filter(f => f !== this.page!.mainFrame())];

    for (const frame of frames) {
      const fLoc = (sel: string) => frame.locator(sel);

      // 1. النص الظاهر (getByRole button/link)
      if (await tryClick(frame.getByRole("button", { name: text, exact: false }))) return true;
      if (await tryClick(frame.getByRole("link",   { name: text, exact: false }))) return true;

      // 2. النص المرئي العام
      if (await tryClick(frame.getByText(text, { exact: false }))) return true;

      // 3. value= (أزرار submit التقليدية <input type=submit value="...">)
      if (await tryClick(fLoc(`input[type="submit"][value*="${text}"]`))) return true;
      if (await tryClick(fLoc(`button[name*="${text}"]`))) return true;

      // 4. aria-label
      if (await tryClick(fLoc(`[aria-label*="${text}"]`))) return true;

      // 5. النص الجزئي (text= selector)
      try {
        await frame.click(`text=${text}`, { timeout: 3000 });
        await this.page!.waitForTimeout(1200);
        return true;
      } catch { }
    }

    // 6. احتياطي: إذا كان النص يدل على تسجيل الدخول — جرّب أي زر submit في الصفحة
    const loginKeywords = ["log in", "login", "sign in", "signin", "تسجيل الدخول", "دخول", "submit", "إرسال", "continue", "متابعة", "next", "التالي"];
    const isLoginLike = loginKeywords.some(k => text.toLowerCase().includes(k.toLowerCase()));
    if (isLoginLike) {
      for (const frame of frames) {
        const fLoc = (sel: string) => frame.locator(sel);
        if (await tryClick(fLoc(`button[type="submit"]`))) return true;
        if (await tryClick(fLoc(`input[type="submit"]`))) return true;
        if (await tryClick(fLoc(`[data-testid*="login"]`))) return true;
        if (await tryClick(fLoc(`[id*="login"]`))) return true;
        if (await tryClick(fLoc(`[class*="login"]`))) return true;
      }
      // آخر محاولة: اضغط Enter في الصفحة
      try {
        await this.page.keyboard.press("Enter");
        await this.page.waitForTimeout(1200);
        return true;
      } catch { }
    }

    return false;
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

    // البحث في كل الإطارات (الرئيسي + iframes)
    const frames = [this.page.mainFrame(), ...this.page.frames().filter(f => f !== this.page!.mainFrame())];

    for (const frame of frames) {
      const tryFill = async (loc: import("playwright").Locator): Promise<boolean> => {
        try {
          await loc.first().waitFor({ state: "visible", timeout: 2000 });
          await loc.first().fill(value);
          return true;
        } catch {
          // محاولة click+type كبديل
          try {
            await loc.first().click({ timeout: 1500 });
            await loc.first().fill(value);
            return true;
          } catch { return false; }
        }
      };

      // استخدام locator من الإطار المحدد
      const fLoc = (sel: string) => frame.locator(sel);
      const byLabel = frame.getByLabel(hint, { exact: false });

      // 1. Playwright getByLabel
      if (await tryFill(byLabel)) return true;
      // 2. placeholder
      if (await tryFill(fLoc(`[placeholder*="${hint}"]`))) return true;
      // 3. name يطابق تماماً
      if (await tryFill(fLoc(`[name="${hint}"]`))) return true;
      // 4. name يحتوي على النص
      if (await tryFill(fLoc(`[name*="${hint}"]`))) return true;
      // 5. id يطابق
      if (await tryFill(fLoc(`[id="${hint}"]`))) return true;
      // 6. aria-label
      if (await tryFill(fLoc(`[aria-label*="${hint}"]`))) return true;

      // 7. بحث شامل عبر evaluate مع React-safe setter
      try {
        const found = await frame.evaluate(({ hint, value }) => {
          const h = hint.toLowerCase();
          const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set ||
                     Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
          const reactSet = (inp: HTMLInputElement | HTMLTextAreaElement, val: string) => {
            if (ns) ns.call(inp, val); else inp.value = val;
            inp.dispatchEvent(new Event("input",  { bubbles: true }));
            inp.dispatchEvent(new Event("change", { bubbles: true }));
            // React Fiber
            try {
              const fk = Object.keys(inp).find(k => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
              if (fk) {
                let fiber = (inp as any)[fk];
                while (fiber) {
                  const props = fiber.memoizedProps || fiber.pendingProps;
                  if (props?.onChange) { props.onChange({ target: inp, currentTarget: inp, bubbles: true, preventDefault: () => {}, stopPropagation: () => {}, persist: () => {} }); break; }
                  fiber = fiber.return;
                }
              }
            } catch (_) {}
          };
          for (const inp of Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input:not([type='submit']):not([type='button']):not([type='checkbox']):not([type='radio']), textarea"))) {
            const label = inp.labels?.[0]?.textContent?.toLowerCase() || "";
            const ph    = (inp.placeholder || "").toLowerCase();
            const nm    = (inp.name        || "").toLowerCase();
            const id    = (inp.id          || "").toLowerCase();
            const ariaLbl = (inp.getAttribute("aria-label") || "").toLowerCase();
            if (label.includes(h) || ph.includes(h) || nm.includes(h) || id.includes(h) || ariaLbl.includes(h)) {
              inp.focus();
              reactSet(inp, value);
              return true;
            }
          }
          return false;
        }, { hint, value });
        if (found) return true;
      } catch { /* تجاهل */ }
    }

    return false;
  }

  // التعامل مع القوائم المنسدلة المخصصة (غير native) — مثل React Select, MUI, Ant Design
  async smartDropdown(hint: string, value: string): Promise<boolean> {
    if (!this.page) return false;

    const h = hint.toLowerCase();
    const v = value.toLowerCase();

    // دالة للبحث عن وفتح القائمة المنسدلة المخصصة
    const tryOpen = async (selector: string): Promise<boolean> => {
      try {
        const loc = this.page!.locator(selector).first();
        await loc.waitFor({ state: "visible", timeout: 3000 });
        await loc.click();
        await this.page!.waitForTimeout(600);
        return true;
      } catch { return false; }
    };

    // البحث عن العنصر المشغّل للقائمة
    const opened = await this.page.evaluate(async ({ h }) => {
      const candidates: Element[] = [];

      // combobox / listbox بـ ARIA
      candidates.push(...Array.from(document.querySelectorAll('[role="combobox"], [role="listbox"], [aria-haspopup="listbox"], [aria-haspopup="true"]')));
      // عناصر تبدو كقوائم منسدلة مخصصة
      candidates.push(...Array.from(document.querySelectorAll('[class*="select" i], [class*="dropdown" i], [class*="picker" i], [class*="combobox" i]')));
      // عناصر data-* شائعة
      candidates.push(...Array.from(document.querySelectorAll('[data-select], [data-dropdown]')));

      for (const el of candidates) {
        const text   = (el as HTMLElement).innerText?.toLowerCase() || "";
        const aria   = (el.getAttribute("aria-label") || "").toLowerCase();
        const name   = (el.getAttribute("name") || "").toLowerCase();
        const id     = (el.id || "").toLowerCase();
        const ph     = (el.getAttribute("placeholder") || "").toLowerCase();
        const lbl    = (el.closest("label") || document.querySelector(`label[for="${el.id}"]`));
        const lblTxt = lbl ? (lbl as HTMLElement).innerText?.toLowerCase() : "";

        if (aria.includes(h) || name.includes(h) || id.includes(h) || ph.includes(h) || lblTxt.includes(h)) {
          (el as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, { h });

    if (!opened) {
      // محاولة فتح بـ getByLabel
      try {
        const trigger = this.page.getByLabel(hint, { exact: false }).first();
        await trigger.waitFor({ state: "visible", timeout: 2000 });
        await trigger.click();
        await this.page.waitForTimeout(600);
      } catch {
        // محاولة بـ role=combobox مع نص يطابق hint
        const found = await tryOpen(`[role="combobox"][aria-label*="${hint}"]`) ||
                      await tryOpen(`[role="combobox"][placeholder*="${hint}"]`) ||
                      await tryOpen(`[aria-label*="${hint}"]`);
        if (!found) return false;
      }
    } else {
      await this.page.waitForTimeout(600);
    }

    // الآن البحث عن الخيار في القائمة المفتوحة
    try {
      // خيارات ARIA
      const optionFound = await this.page.evaluate(({ v }) => {
        const options = Array.from(document.querySelectorAll(
          '[role="option"], [role="listitem"], [class*="option" i], [class*="item" i], [class*="choice" i], li'
        ));
        for (const opt of options) {
          const el = opt as HTMLElement;
          if (!el.offsetParent && !el.closest('[aria-expanded="true"]') && el.style.display === "none") continue;
          const txt = el.innerText?.toLowerCase().trim() || "";
          if (txt === v || txt.includes(v) || v.includes(txt)) {
            el.click();
            return true;
          }
        }
        return false;
      }, { v });

      if (optionFound) return true;

      // محاولة بـ Playwright getByRole option
      try {
        await this.page.getByRole("option", { name: value }).first().click({ timeout: 3000 });
        return true;
      } catch {}

      // محاولة بـ نص مرئي
      try {
        await this.page.locator(`text="${value}"`).first().click({ timeout: 3000 });
        return true;
      } catch {}

    } catch {}

    return false;
  }

  // دالة مساعدة: React-safe setter لعنصر select بناءً على index عالمي في الصفحة
  private async _selectByEvaluate(
    frame: import("playwright").Frame,
    selectorOrNth: string | number,
    value: string,
    v: string,
  ): Promise<boolean> {
    return frame.evaluate(
      (args: { selectorOrNth: string | number; value: string; v: string }) => {
        let el: HTMLSelectElement | null = null;
        if (typeof args.selectorOrNth === "number") {
          const all = Array.from(document.querySelectorAll<HTMLSelectElement>("select"));
          el = all[args.selectorOrNth] ?? null;
        } else {
          el = document.querySelector<HTMLSelectElement>(args.selectorOrNth);
        }
        if (!el) return false;

        const opts = Array.from(el.options);
        // بحث مرن: exact value → exact text → partial text
        let match = opts.find(function(o) {
          return o.value === args.value || o.value.toLowerCase() === args.v;
        });
        if (!match) match = opts.find(function(o) {
          return o.text.toLowerCase() === args.v;
        });
        if (!match) match = opts.find(function(o) {
          return o.text.toLowerCase().includes(args.v) || args.v.includes(o.text.toLowerCase().trim());
        });
        if (!match) return false;

        // React-safe setter
        const proto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value");
        const ns = proto && proto.set;
        if (ns) ns.call(el, match.value); else el.value = match.value;

        // أحداث DOM
        el.dispatchEvent(new Event("input",  { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));

        // React Fiber — إطلاق onChange المركّب
        const fk = Object.keys(el).find(function(k) {
          return k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance") || k.startsWith("__reactEventHandlers");
        });
        if (fk) {
          let fiber = (el as any)[fk];
          let attempts = 0;
          while (fiber && attempts++ < 30) {
            const p = fiber.memoizedProps || fiber.pendingProps;
            if (p && typeof p.onChange === "function") {
              try {
                p.onChange({
                  target: el, currentTarget: el, bubbles: true, type: "change",
                  preventDefault: function() {}, stopPropagation: function() {}, persist: function() {},
                  nativeEvent: { target: el },
                });
              } catch (_) {}
              break;
            }
            fiber = fiber.return;
          }
        }
        return true;
      },
      { selectorOrNth, value, v },
    ).catch(() => false);
  }

  // اختيار قيمة من قائمة — يدعم native <select> والقوائم المخصصة وراديو بتونز
  async smartSelect(hint: string, value: string): Promise<boolean> {
    if (!this.page) return false;

    const h = hint.toLowerCase().trim();
    const v = value.toLowerCase().trim();

    // استخراج المقطع الأخير من الـ hint (birthday_day → day، birthday_month → month)
    const hintParts = hint.split(/[_\-\s]+/);
    const shortHint = hintParts[hintParts.length - 1].toLowerCase();

    // ── 0. دعم تنسيق nth:N=value (الأكثر دقة) ──────────────────────────
    // مثال: hint = "nth:1", value = "February" ← يختار القائمة الثانية
    const nthMatch = h.match(/^nth:?(\d+)$/);
    if (nthMatch) {
      const nthIdx = parseInt(nthMatch[1], 10);
      for (const frame of this.page.frames()) {
        const ok = await this._selectByEvaluate(frame, nthIdx, value, v);
        if (ok) { console.log(`[select] nth:${nthIdx} explicit OK`); return true; }
      }
    }

    // ── 1. خريطة تاريخ الميلاد: أكثر الحالات شيوعاً — يستخدم الترتيب مباشرة ──
    // فيسبوك وكثير من المواقع: أول select=يوم، ثاني=شهر، ثالث=سنة
    const birthdayNthMap: Record<string, number> = {
      "day": 0, "يوم": 0, "اليوم": 0,
      "month": 1, "شهر": 1, "الشهر": 1,
      "year": 2, "سنة": 2, "السنة": 2, "عام": 2,
    };
    const birthdayNth = birthdayNthMap[h] ?? birthdayNthMap[shortHint] ?? -1;

    if (birthdayNth >= 0) {
      console.log(`[select] birthday nth[${birthdayNth}] for hint="${hint}" value="${value}"`);
      for (const frame of this.page.frames()) {
        // أولاً: جرّب Playwright selectOption على العنصر في موضعه
        try {
          const allSelects = await frame.locator("select").all();
          if (birthdayNth < allSelects.length) {
            const loc = allSelects[birthdayNth];
            try { await loc.selectOption({ value }, { timeout: 1500 }); console.log(`[select] birthday playwright value OK`); return true; } catch {}
            try { await loc.selectOption({ label: value }, { timeout: 1500 }); console.log(`[select] birthday playwright label OK`); return true; } catch {}
          }
        } catch {}
        // ثانياً: evaluate مع React-safe setter
        const ok = await this._selectByEvaluate(frame, birthdayNth, value, v);
        if (ok) { console.log(`[select] birthday nth[${birthdayNth}] react-safe OK`); return true; }
      }
    }

    // ── 2. محاولة native <select> بالاسم أو الـ id ──────────────────────
    const nativeSelectors = [
      `select[name="${hint}"]`,    `select[id="${hint}"]`,
      `select[name="${shortHint}"]`, `select[id="${shortHint}"]`,
      `select[name*="${hint}"]`,   `select[id*="${hint}"]`,
      `select[name*="${shortHint}"]`, `select[id*="${shortHint}"]`,
    ];

    for (const sel of nativeSelectors) {
      for (const frame of this.page.frames()) {
        try {
          const count = await frame.locator(sel).count();
          if (count === 0) continue;
          // Playwright أولاً
          const loc = frame.locator(sel).first();
          try { await loc.selectOption({ value }, { timeout: 1500 }); console.log(`[select] native value OK: ${sel}`); return true; } catch {}
          try { await loc.selectOption({ label: value }, { timeout: 1500 }); console.log(`[select] native label OK: ${sel}`); return true; } catch {}
          // React-safe setter
          const ok = await this._selectByEvaluate(frame, sel, value, v);
          if (ok) { console.log(`[select] native react-safe OK: ${sel}`); return true; }
        } catch {}
      }
    }

    // ── 3. بحث شامل في كل select — يطابق بناءً على الاسم/id/aria/label ──
    for (const frame of this.page.frames()) {
      try {
        const result = await frame.evaluate(
          (args: { h: string; sh: string; v: string; value: string }) => {
            const selects = Array.from(document.querySelectorAll<HTMLSelectElement>("select"));
            for (const el of selects) {
              const name  = (el.name  || "").toLowerCase();
              const id    = (el.id    || "").toLowerCase();
              const aria  = (el.getAttribute("aria-label") || "").toLowerCase();
              const lbl   = (el.labels?.[0]?.textContent   || "").toLowerCase();
              const prev  = ((el.previousElementSibling as HTMLElement | null)?.textContent || "").toLowerCase();
              const ctx   = [name, id, aria, lbl, prev].join(" ");

              // المطابقة: الـ ctx يحتوي على hint أو hint يحتوي على id/name
              const match = ctx.includes(args.h) || ctx.includes(args.sh)
                         || (id   && args.h.includes(id))
                         || (name && args.h.includes(name));
              if (!match) continue;

              const opts = Array.from(el.options);
              const opt  = opts.find(function(o) {
                return o.value === args.value || o.value.toLowerCase() === args.v
                    || o.text.toLowerCase() === args.v
                    || o.text.toLowerCase().includes(args.v)
                    || args.v.includes(o.text.toLowerCase().trim());
              });
              if (!opt) continue;

              // React-safe setter
              const proto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value");
              const ns = proto?.set;
              if (ns) ns.call(el, opt.value); else el.value = opt.value;
              el.dispatchEvent(new Event("input",  { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              const fk = Object.keys(el).find(function(k) {
                return k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance") || k.startsWith("__reactEventHandlers");
              });
              if (fk) {
                let fiber = (el as any)[fk]; let att = 0;
                while (fiber && att++ < 30) {
                  const p = fiber.memoizedProps || fiber.pendingProps;
                  if (p?.onChange) { try { p.onChange({ target: el, currentTarget: el, bubbles: true, type: "change", preventDefault: function(){}, stopPropagation: function(){}, persist: function(){}, nativeEvent: { target: el } }); } catch(_){} break; }
                  fiber = fiber.return;
                }
              }
              return true;
            }
            return false;
          },
          { h, sh: shortHint, v, value },
        );
        if (result) { console.log(`[select] broad search OK`); return true; }
      } catch {}
    }

    // ── 4. Radio buttons (جنس / نعم-لا) ──────────────────────────────────
    for (const frame of this.page.frames()) {
      try {
        const clicked = await frame.evaluate(
          (args: { h: string; v: string; value: string }) => {
            const radios = Array.from(document.querySelectorAll<HTMLInputElement>("input[type='radio']"));
            for (const r of radios) {
              const lbl    = (r.labels?.[0]?.textContent || "").toLowerCase();
              const aria   = (r.getAttribute("aria-label") || "").toLowerCase();
              const rv     = (r.value || "").toLowerCase();
              const parent = (r.parentElement?.textContent || "").toLowerCase();
              const all    = [lbl, aria, rv, parent].join(" ");
              if (all.includes(args.v) || args.v.includes(rv) || (args.h && all.includes(args.h))) {
                r.click();
                r.dispatchEvent(new Event("change", { bubbles: true }));
                return true;
              }
            }
            return false;
          },
          { h, v, value },
        );
        if (clicked) { console.log(`[select] radio clicked for "${value}"`); return true; }
      } catch {}
    }

    // ── 5. القوائم المخصصة (React/MUI) — Click + Pick ──────────────────
    console.log(`[select] trying custom dropdown for hint="${hint}" value="${value}"`);
    return this._customDropdownSelect(hint, value);
  }

  // قوائم React/MUI المخصصة: انقر على المشغّل ثم انقر الخيار
  private async _customDropdownSelect(hint: string, value: string): Promise<boolean> {
    if (!this.page) return false;
    const h = hint.toLowerCase();
    const v = value.toLowerCase();
    // استخراج shortHint (birthday_day → day)
    const hParts = hint.split(/[_\-\s]+/);
    const short = hParts[hParts.length - 1].toLowerCase();

    // محاولات فتح القائمة بتسلسل متدرج
    const triggerSelectors = [
      `[role="combobox"][aria-label*="${hint}"]`,
      `[role="combobox"][name*="${hint}"]`,
      `[role="combobox"][id*="${hint}"]`,
      `[role="combobox"][aria-label*="${short}"]`,
      `[role="combobox"][name*="${short}"]`,
      `[role="combobox"][id*="${short}"]`,
      `[aria-label*="${hint}"][aria-haspopup]`,
      `[aria-label*="${short}"][aria-haspopup]`,
      `[name="${hint}"]`,
      `[name="${short}"]`,
    ];

    // محاولة فتح بـ selector مباشر
    for (const sel of triggerSelectors) {
      try {
        const loc = this.page.locator(sel).first();
        if (await loc.count() > 0) {
          await loc.click({ timeout: 2000 });
          await this.page.waitForTimeout(500);
          // بحث عن الخيار المطلوب بعد فتح القائمة
          if (await this._pickOpenOption(v)) return true;
        }
      } catch {}
    }

    // بحث شامل في DOM عن زر القائمة بالنص/aria
    try {
      const opened = await this.page.evaluate((args: { h: string; short: string }) => {
        const candidates = Array.from(document.querySelectorAll<HTMLElement>('[role="combobox"],[role="listbox"],[aria-haspopup="listbox"],[aria-haspopup="true"],[class*="select"],[class*="dropdown"],[class*="picker"]'));
        for (const el of candidates) {
          const ctx = [el.getAttribute("aria-label") || "", el.getAttribute("name") || "", el.id || "", el.getAttribute("placeholder") || "", (el.closest("label") ? (el.closest("label") as HTMLElement).innerText : "") || ""].join(" ").toLowerCase();
          if (ctx.includes(args.h) || ctx.includes(args.short) || args.h.includes(el.id.toLowerCase()) || args.h.includes((el.getAttribute("name") || "").toLowerCase())) {
            el.click(); return true;
          }
        }
        return false;
      }, { h, short });
      if (opened) {
        await this.page.waitForTimeout(500);
        if (await this._pickOpenOption(v)) return true;
      }
    } catch {}

    return false;
  }

  // انقر على خيار مرئي في قائمة مفتوحة
  private async _pickOpenOption(v: string): Promise<boolean> {
    if (!this.page) return false;

    // محاولة 1: getByRole option
    try {
      await this.page.getByRole("option", { name: new RegExp(v, "i") }).first().click({ timeout: 2000 });
      return true;
    } catch {}

    // محاولة 2: نص مرئي
    try {
      await this.page.locator(`[role="option"]:has-text("${v}")`).first().click({ timeout: 2000 });
      return true;
    } catch {}

    // محاولة 3: li يحتوي نص مطابق
    try {
      const clicked = await this.page.evaluate((args: { v: string }) => {
        const opts = Array.from(document.querySelectorAll<HTMLElement>('[role="option"],[role="listitem"],[class*="option"],[class*="item"] li'));
        for (const el of opts) {
          if (!el.offsetParent && el.style.display === "none") continue;
          const txt = el.innerText ? el.innerText.toLowerCase().trim() : "";
          if (txt === args.v || txt.includes(args.v) || args.v.includes(txt)) { el.click(); return true; }
        }
        return false;
      }, { v });
      if (clicked) return true;
    } catch {}

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
      // البحث في كل الإطارات (الرئيسي + iframes)
      const frames = this.page.frames();
      let bestFrame = this.page.mainFrame();
      // اختر الإطار الذي يحتوي على أكثر عناصر إدخال (على الأرجح النموذج)
      let maxInputs = 0;
      for (const frame of frames) {
        try {
          const count = await frame.evaluate(() => document.querySelectorAll("input, select, textarea").length);
          if (count > maxInputs) { maxInputs = count; bestFrame = frame; }
        } catch {}
      }
      if (frames.length > 1) {
        console.log(`[getPageStructure] frames: ${frames.length}, using frame with ${maxInputs} inputs: ${bestFrame.url()}`);
      }

      const data = await bestFrame.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input, textarea, select")).slice(0, 20).map((el: any) => {
          const base: any = {
            tag: el.tagName.toLowerCase(),
            type: el.type || "",
            name: el.name || "",
            id: el.id || "",
            placeholder: el.placeholder || "",
            label: el.labels?.[0]?.textContent?.trim() || "",
          };
          if (el.tagName === "SELECT") {
            const allOpts = Array.from(el.options).map((o: any) => o.text.trim()).filter(Boolean);
            base.options = allOpts.slice(0, 15);
            base.firstOption = allOpts[0] || "";
          }
          return base;
        });

        // كشف القوائم المنسدلة المخصصة (React Select, MUI, Ant Design, etc.)
        const customDropdowns: any[] = [];
        const seen = new Set<Element>();
        const ddSelectors = [
          '[role="combobox"]', '[role="listbox"]',
          '[aria-haspopup="listbox"]', '[aria-haspopup="true"]',
          '[class*="select" i]:not(select)', '[class*="dropdown" i]',
          '[class*="picker" i]', '[class*="combobox" i]',
        ];
        for (const sel of ddSelectors) {
          for (const el of Array.from(document.querySelectorAll(sel)).slice(0, 10)) {
            if (seen.has(el)) continue;
            // تجاهل العناصر غير المرئية
            const rect = (el as HTMLElement).getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            seen.add(el);
            const ariaLabel = el.getAttribute("aria-label") || "";
            const name = el.getAttribute("name") || "";
            const id = el.id || "";
            const ph = el.getAttribute("placeholder") || "";
            const lbl = document.querySelector(`label[for="${id}"]`);
            const lblText = lbl ? (lbl as HTMLElement).innerText?.trim() : "";
            const innerText = (el as HTMLElement).innerText?.trim().slice(0, 40) || "";
            customDropdowns.push({ ariaLabel, name, id, placeholder: ph, label: lblText, currentText: innerText });
          }
        }

        const buttons = Array.from(document.querySelectorAll("button, [role='button'], input[type='submit'], input[type='button'], a.btn, a[href]")).slice(0, 30).map((el: any) => ({
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim().slice(0, 60) || "",
          href: el.href || "",
          type: el.type || "",
        }));

        const title = document.title || "";
        const url = window.location.href;

        return { inputs, customDropdowns, buttons, title, url };
      });

      const lines: string[] = [];
      lines.push(`الصفحة: ${data.title}`);
      lines.push(`URL: ${data.url}`);

      if (data.inputs.length === 0) {
        lines.push("\n⚠️ لا توجد حقول إدخال مرئية في هذه الصفحة.");
        lines.push("الصفحة محملة بالكامل. للمتابعة: انقر على زر/رابط للتنقل نحو صفحة تسجيل الدخول أو النموذج المطلوب.");
        lines.push("استخدم click على أحد الأزرار/الروابط المدرجة أدناه — لا تستخدم wait.");
      } else {
        lines.push("\nحقول الإدخال:");
      }

      if (data.inputs.length > 0) {
        let selectIdx = 0;
        data.inputs.forEach((inp: any) => {
          const visibleLabel = inp.label || inp.placeholder || "";
          const fillKey      = inp.name || inp.id || inp.type;
          if (inp.tag === "select") {
            const opts        = (inp.options || []).join(" | ");
            const firstOpt    = inp.firstOption || "";
            const labelHint   = visibleLabel || firstOpt;
            const currentIdx  = selectIdx++;
            // أظهر كلا الصيغتين: الاسم/id والترتيب (nth)
            const nameKey  = fillKey && fillKey !== "select" ? `select PARAM: ${fillKey}=<الخيار>` : "";
            const nthKey   = `select PARAM: nth:${currentIdx}=<الخيار>`;
            lines.push(
              `  - [قائمة#${currentIdx}] ${nameKey ? nameKey + "  أو  " : ""}${nthKey}` +
              `  (تسمية: "${labelHint}", خيارات: ${opts})`
            );
          } else {
            const identifier = inp.name ? `name="${inp.name}"` : (inp.id ? `id="${inp.id}"` : `type="${inp.type}"`);
            lines.push(`  - [حقل] fill PARAM: ${fillKey}=<القيمة>  (${identifier}${visibleLabel ? `, تسمية: "${visibleLabel}"` : ""})`);
          }
        });
      }

      if (data.customDropdowns && data.customDropdowns.length > 0) {
        lines.push("\nقوائم منسدلة مخصصة (استخدم select):");
        data.customDropdowns.forEach((dd: any) => {
          const key = dd.name || dd.id || dd.ariaLabel || dd.label || dd.placeholder || "dropdown";
          const lbl = dd.label || dd.ariaLabel || dd.placeholder || dd.currentText || "";
          lines.push(`  - [قائمة مخصصة] select PARAM: ${key}=<الخيار>  (تسمية: "${lbl}")`);
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

  // كشف رسائل الخطأ الظاهرة في الصفحة
  async detectErrors(): Promise<string[]> {
    if (!this.page) return [];
    try {
      return await this.page.evaluate(() => {
        const selectors = [
          '[role="alert"]', '[aria-live="assertive"]', '[aria-live="polite"]',
          '[class*="error" i]', '[class*="invalid" i]', '[class*="warning" i]',
          '[class*="alert" i]', '[data-testid*="error" i]', 'span._6qs9',
        ];
        const seen = new Set<string>();
        const results: string[] = [];
        for (const sel of selectors) {
          for (const el of Array.from(document.querySelectorAll(sel))) {
            const t = (el as HTMLElement).innerText?.trim();
            if (t && t.length > 4 && t.length < 250 && !seen.has(t)) {
              seen.add(t);
              results.push(t);
            }
          }
        }
        return results.slice(0, 4);
      });
    } catch { return []; }
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
