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

  // اختيار قيمة من قائمة <select> بطريقة ذكية (بالنص أو القيمة أو الرقم)
  async smartSelect(hint: string, value: string): Promise<boolean> {
    if (!this.page) return false;

    // دالة React-safe متقدمة: تضبط القيمة عبر React Fiber مباشرةً
    const reactSet = async (sel: string, optValue: string): Promise<void> => {
      await this.page!.evaluate(({ selector, val }) => {
        const el = document.querySelector<HTMLSelectElement>(selector);
        if (!el) return;

        // الخطوة 1: ضبط القيمة باستخدام native setter
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLSelectElement.prototype, "value"
        )?.set;
        if (nativeSetter) nativeSetter.call(el, val);
        else el.value = val;

        // الخطوة 2: إطلاق أحداث DOM الأصيلة
        el.dispatchEvent(new Event("input",  { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));

        // الخطوة 3: React Fiber — استدعاء onChange مباشرةً
        try {
          const fiberKey = Object.keys(el).find(k =>
            k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance")
          );
          if (fiberKey) {
            let fiber = (el as any)[fiberKey];
            while (fiber) {
              const props = fiber.memoizedProps || fiber.pendingProps;
              if (props?.onChange && typeof props.onChange === "function") {
                // بناء حدث اصطناعي يحاكي React SyntheticEvent
                const fakeEvent = {
                  target: el,
                  currentTarget: el,
                  nativeEvent: new Event("change", { bubbles: true }),
                  bubbles: true,
                  preventDefault: () => {},
                  stopPropagation: () => {},
                  isPersistent: () => true,
                  persist: () => {},
                };
                props.onChange(fakeEvent);
                break;
              }
              fiber = fiber.return;
            }
          }
        } catch (_) { /* React Fiber غير متاح */ }

        // الخطوة 4: InputEvent بدلاً من Event (لـ React 18+)
        try {
          el.dispatchEvent(new InputEvent("input",  { bubbles: true, data: val }));
          el.dispatchEvent(new InputEvent("change", { bubbles: true }));
        } catch (_) {}
      }, { selector: sel, val: optValue });
    };

    // التحقق من أن قيمة select تغيّرت فعلاً بعد الاختيار (مع انتظار render React)
    const verifySelected = async (selector: string, expectedValue: string): Promise<boolean> => {
      try {
        // انتظر React لإعادة الرسم
        await this.page!.waitForTimeout(150);
        const loc = this.page!.locator(selector).first();
        const currentVal = await loc.inputValue().catch(() => "");
        // تحقق من القيمة أو النص المعروض
        const currentText = currentVal
          ? await loc.locator(`option[value="${currentVal}"]`).textContent().catch(() => currentVal)
          : "";
        const ev = expectedValue.toLowerCase();
        if (!currentVal && !currentText) return false;
        return currentVal.toLowerCase() === ev ||
               (currentText || "").toLowerCase().includes(ev) ||
               ev.includes((currentText || "").toLowerCase().trim());
      } catch { return false; }
    };

    // اختيار بالكيبورد: ضغط مفاتيح لاختيار القيمة المطلوبة
    const tryKeyboard = async (selector: string): Promise<boolean> => {
      try {
        const loc = this.page!.locator(selector).first();
        await loc.waitFor({ state: "visible", timeout: 3000 });
        await loc.click();
        await this.page!.waitForTimeout(200);
        // ضغط الحرف الأول من القيمة للقفز إليها
        const firstChar = value[0]?.toLowerCase() || "";
        if (firstChar) {
          await loc.press(firstChar);
          await this.page!.waitForTimeout(100);
        }
        // انتقل بالأسهم لإيجاد الخيار الصحيح (حتى 50 مرة)
        for (let i = 0; i < 50; i++) {
          const cur = await loc.inputValue().catch(() => "");
          const curText = await loc.locator(`option[value="${cur}"]`).textContent().catch(() => cur);
          const ev = value.toLowerCase();
          if (cur.toLowerCase() === ev || (curText || "").toLowerCase().includes(ev) || ev.includes((curText || "").toLowerCase().trim())) {
            // تأكيد الاختيار بـ Enter
            await loc.press("Enter");
            await this.page!.waitForTimeout(100);
            return true;
          }
          await loc.press("ArrowDown");
          await this.page!.waitForTimeout(50);
        }
        // جرّب أيضاً من البداية بالضغط إلى الأعلى
        for (let i = 0; i < 50; i++) {
          const cur = await loc.inputValue().catch(() => "");
          const curText = await loc.locator(`option[value="${cur}"]`).textContent().catch(() => cur);
          const ev = value.toLowerCase();
          if (cur.toLowerCase() === ev || (curText || "").toLowerCase().includes(ev) || ev.includes((curText || "").toLowerCase().trim())) {
            await loc.press("Enter");
            return true;
          }
          await loc.press("ArrowUp");
          await this.page!.waitForTimeout(50);
        }
        return false;
      } catch { return false; }
    };

    // استراتيجية 1: selectOption + reactSet (React Fiber) + keyboard
    const tryPlaywright = async (selector: string): Promise<boolean> => {
      try {
        const loc = this.page!.locator(selector).first();
        await loc.waitFor({ state: "attached", timeout: 3000 });

        // --- جمع كل الخيارات أولاً ---
        const opts = await loc.locator("option").all();
        const candidates: string[] = [];
        for (const o of opts) {
          const txt = (await o.textContent() || "").trim();
          const val = (await o.getAttribute("value") || "").trim();
          if (txt.includes(value) || value.includes(txt.toLowerCase()) ||
              val === value || val.toLowerCase() === value.toLowerCase() ||
              txt.toLowerCase() === value.toLowerCase()) {
            if (val) candidates.push(val);
          }
        }
        // إضافة القيمة الأصلية للمحاولات
        if (!candidates.includes(value)) candidates.unshift(value);

        for (const candidate of candidates) {
          // محاولة 1: Playwright selectOption بالقيمة
          try { await loc.selectOption({ value: candidate }, { timeout: 1500 }); } catch {}
          if (await verifySelected(selector, value)) return true;

          // محاولة 2: Playwright selectOption بالتسمية
          try { await loc.selectOption({ label: candidate }, { timeout: 1500 }); } catch {}
          if (await verifySelected(selector, value)) return true;

          // محاولة 3: React Fiber - استدعاء onChange مباشرة
          try { await reactSet(selector, candidate); } catch {}
          if (await verifySelected(selector, value)) return true;
        }

        // محاولة 4: Playwright selectOption بالتسمية للقيمة الأصلية
        try { await loc.selectOption({ label: value }, { timeout: 1500 }); } catch {}
        if (await verifySelected(selector, value)) return true;

        // محاولة 5: اختيار بالكيبورد
        return tryKeyboard(selector);
      } catch { return false; }
    };

    if (await tryPlaywright(`select[name="${hint}"]`)) return true;
    if (await tryPlaywright(`select[name*="${hint}"]`)) return true;
    if (await tryPlaywright(`select[id="${hint}"]`))   return true;
    if (await tryPlaywright(`select[id*="${hint}"]`))  return true;

    // استراتيجية 2: بحث شامل في كل عناصر select بالصفحة
    try {
      const found = await this.page.evaluate(({ hint, value }) => {
        const h = hint.toLowerCase();
        const v = value.toLowerCase();

        // React-safe setter
        const reactSetVal = (el: HTMLSelectElement, val: string) => {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLSelectElement.prototype, "value"
          )?.set;
          if (nativeSetter) nativeSetter.call(el, val);
          else el.value = val;
          el.dispatchEvent(new Event("input",  { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        };

        // دالة تجمع كل النصوص المرئية المرتبطة بالعنصر
        const getElementContext = (sel: HTMLSelectElement): string => {
          const parts: string[] = [];
          parts.push((sel.name  || "").toLowerCase());
          parts.push((sel.id    || "").toLowerCase());
          // التسمية المرتبطة (label[for])
          const lbl = sel.labels?.[0]?.textContent || "";
          parts.push(lbl.toLowerCase());
          // aria-label
          parts.push((sel.getAttribute("aria-label") || "").toLowerCase());
          // title
          parts.push((sel.getAttribute("title") || "").toLowerCase());
          // placeholder أو النص المرئي للخيار الأول (كثيراً ما يصف الحقل)
          const firstOpt = sel.options[0]?.text || "";
          parts.push(firstOpt.toLowerCase());
          // النص في العنصر الأب أو الأشقاء المجاورة (للحصول على السياق)
          const parent = sel.parentElement;
          if (parent) parts.push((parent.textContent || "").toLowerCase().slice(0, 100));
          // العنصر السابق مباشرة
          const prev = sel.previousElementSibling;
          if (prev) parts.push((prev.textContent || "").toLowerCase().slice(0, 60));
          return parts.join(" ");
        };

        for (const sel of Array.from(document.querySelectorAll<HTMLSelectElement>("select"))) {
          const ctx = getElementContext(sel);
          if (!ctx.includes(h)) continue;

          // ابحث عن الخيار الأنسب
          const opts = Array.from(sel.options);
          let match = opts.find(o => o.text.toLowerCase() === v || o.value.toLowerCase() === v);
          if (!match) match = opts.find(o => o.text.toLowerCase().includes(v) || v.includes(o.text.toLowerCase().trim()));
          if (!match) match = opts.find(o => o.value === value);

          if (match) {
            reactSetVal(sel, match.value);
            return true;
          }
        }
        return false;
      }, { hint, value });
      if (found) return true;
    } catch {}

    // استراتيجية 2b: نفس البحث بالسياق لكن بالكيبورد بدلاً من JS (أكثر موثوقية مع React)
    try {
      const selectors = await this.page.evaluate(({ hint }) => {
        const h = hint.toLowerCase();
        const getCtx = (sel: HTMLSelectElement) => {
          const parts: string[] = [];
          const name = (sel.name || sel.id || sel.getAttribute("aria-label") || "").toLowerCase();
          parts.push(name);
          // نص الخيار الأول
          const first = sel.options[0]?.text?.toLowerCase() || "";
          parts.push(first);
          const parent = sel.closest("label") || sel.parentElement;
          if (parent) parts.push((parent.textContent || "").toLowerCase().slice(0, 100));
          const prev = sel.previousElementSibling;
          if (prev) parts.push((prev.textContent || "").toLowerCase().slice(0, 60));
          return parts.join(" ");
        };
        const results: string[] = [];
        for (const sel of Array.from(document.querySelectorAll<HTMLSelectElement>("select"))) {
          const ctx = getCtx(sel);
          if (!ctx.includes(h)) continue;
          // بناء selector بناءً على name أو id
          if (sel.name) results.push(`select[name="${sel.name}"]`);
          else if (sel.id) results.push(`select#${sel.id}`);
        }
        return results;
      }, { hint });

      for (const sel of selectors) {
        if (await tryKeyboard(sel)) return true;
      }
    } catch {}

    // استراتيجية 3: آخر محاولة — أول select في الصفحة يطابق القيمة
    try {
      const found = await this.page.evaluate(({ value }) => {
        const v = value.toLowerCase();
        const reactSetVal = (el: HTMLSelectElement, val: string) => {
          const s = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
          if (s) s.call(el, val); else el.value = val;
          el.dispatchEvent(new Event("input",  { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        };
        for (const sel of Array.from(document.querySelectorAll<HTMLSelectElement>("select"))) {
          const opts = Array.from(sel.options);
          const match = opts.find(o =>
            o.text.toLowerCase().includes(v) || v.includes(o.text.toLowerCase().trim())
          );
          if (match) { reactSetVal(sel, match.value); return true; }
        }
        return false;
      }, { value });
      if (found) return true;
    } catch {}

    // استراتيجية 4: القوائم المنسدلة المخصصة (React Select, MUI, Ant Design, etc.)
    return this.smartDropdown(hint, value);
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

      if (data.inputs.length > 0) {
        lines.push("\nحقول الإدخال:");
        data.inputs.forEach((inp: any) => {
          const visibleLabel = inp.label || inp.placeholder || "";
          const fillKey      = inp.name || inp.id || inp.type;
          if (inp.tag === "select") {
            const opts = (inp.options || []).join(" | ");
            const firstOpt = inp.firstOption || "";
            const labelHint = visibleLabel || firstOpt;
            lines.push(`  - [قائمة] select PARAM: ${fillKey}=<الخيار>  (مفتاح البحث: "${labelHint}", خيارات: ${opts})`);
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
