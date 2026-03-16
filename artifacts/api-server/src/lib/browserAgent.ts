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

  // اختيار قيمة من قائمة <select> بطريقة ذكية — مع دعم iframes
  async smartSelect(hint: string, value: string): Promise<boolean> {
    if (!this.page) return false;

    const h = hint.toLowerCase();
    const v = value.toLowerCase();

    // دالة React-safe لضبط قيمة <select> وإطلاق الأحداث
    const reactSetInFrame = async (frameEval: (fn: any, arg: any) => Promise<any>, selector: string, optVal: string): Promise<boolean> => {
      try {
        return await frameEval(({ selector, val }: { selector: string; val: string }) => {
          const el = document.querySelector<HTMLSelectElement>(selector);
          if (!el) return false;

          // native setter
          const ns = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
          if (ns) ns.call(el, val); else el.value = val;

          // DOM events
          el.dispatchEvent(new Event("input",  { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));

          // React Fiber
          try {
            const fk = Object.keys(el).find(k => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
            if (fk) {
              let fiber = (el as any)[fk];
              while (fiber) {
                const props = fiber.memoizedProps || fiber.pendingProps;
                if (props?.onChange) {
                  props.onChange({ target: el, currentTarget: el, bubbles: true, preventDefault: () => {}, stopPropagation: () => {}, persist: () => {} });
                  break;
                }
                fiber = fiber.return;
              }
            }
          } catch (_) {}

          return true;
        }, { selector, val: optVal });
      } catch { return false; }
    };

    // البحث في إطار (frame) عن select مناسب وتحديده
    const tryInFrame = async (frame: import("playwright").Frame): Promise<boolean> => {
      try {
        // جمع معلومات جميع عناصر select في الإطار
        const selectInfos: Array<{ selector: string; opts: string[]; optVals: string[] }> = await frame.evaluate(({ h }) => {
          const results: Array<{ selector: string; opts: string[]; optVals: string[] }> = [];
          for (const sel of Array.from(document.querySelectorAll<HTMLSelectElement>("select"))) {
            const ctx = [
              sel.name, sel.id,
              sel.getAttribute("aria-label") || "",
              sel.options[0]?.text || "",
              sel.labels?.[0]?.textContent || "",
              (sel.parentElement?.textContent || "").slice(0, 80),
              (sel.previousElementSibling as HTMLElement | null)?.textContent || "",
            ].join(" ").toLowerCase();

            // قبول أي select يطابق hint أو إذا كانت hint مجرد رقم (قد يكون أي select)
            if (!ctx.includes(h) && h !== "") continue;

            const selector = sel.name
              ? `select[name="${sel.name}"]`
              : sel.id ? `#${sel.id}` : "select";

            results.push({
              selector,
              opts: Array.from(sel.options).map(o => o.text.trim()),
              optVals: Array.from(sel.options).map(o => o.value),
            });
          }
          return results;
        }, { h });

        console.log(`[smartSelect] hint="${hint}" v="${value}" frame=${frame.url()} found ${selectInfos.length} selects`);

        for (const info of selectInfos) {
          const { selector, opts, optVals } = info;

          // إيجاد الخيار المناسب
          let matchIdx = -1;
          matchIdx = opts.findIndex(o => o.toLowerCase() === v);
          if (matchIdx < 0) matchIdx = opts.findIndex(o => o.toLowerCase().includes(v) || v.includes(o.toLowerCase().trim()));
          if (matchIdx < 0) matchIdx = optVals.findIndex(ov => ov === value || ov.toLowerCase() === v);
          // مطابقة رقمية (مثلاً "15" يطابق الخيار ذو القيمة "15")
          if (matchIdx < 0) matchIdx = optVals.findIndex(ov => ov === value);

          if (matchIdx >= 0) {
            const optVal = optVals[matchIdx];
            const optLabel = opts[matchIdx];
            console.log(`[smartSelect] selecting "${optLabel}" (val="${optVal}") from ${selector}`);

            // محاولة 1: Playwright selectOption مع label
            try {
              const loc = frame.locator(selector).first();
              await loc.selectOption({ label: optLabel }, { timeout: 2000 });
              console.log(`[smartSelect] selectOption(label) succeeded`);
              return true;
            } catch {}

            // محاولة 2: Playwright selectOption مع value
            try {
              const loc = frame.locator(selector).first();
              await loc.selectOption({ value: optVal }, { timeout: 2000 });
              console.log(`[smartSelect] selectOption(value) succeeded`);
              return true;
            } catch {}

            // محاولة 3: React-safe evaluate
            const ok = await reactSetInFrame(
              (fn: any, arg: any) => frame.evaluate(fn, arg),
              selector, optVal
            );
            if (ok) {
              console.log(`[smartSelect] reactSet succeeded`);
              await frame.waitForTimeout(400);
              return true;
            }

            // محاولة 4: Playwright selectOption بالفهرس
            try {
              const loc = frame.locator(selector).first();
              await loc.selectOption({ index: matchIdx }, { timeout: 2000 });
              console.log(`[smartSelect] selectOption(index) succeeded`);
              return true;
            } catch {}
          } else {
            console.log(`[smartSelect] no matching option for "${value}" in opts: ${opts.slice(0, 10).join(", ")}`);
          }
        }

        // إذا لم يُعثر على select بـ hint، جرّب كل select ويطابق قيمة الخيار
        if (selectInfos.length === 0) {
          const foundAny = await frame.evaluate(({ v, value }) => {
            const ns = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
            const reactSet = (el: HTMLSelectElement, val: string) => {
              if (ns) ns.call(el, val); else el.value = val;
              el.dispatchEvent(new Event("input",  { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            };
            for (const sel of Array.from(document.querySelectorAll<HTMLSelectElement>("select"))) {
              const match = Array.from(sel.options).find(o =>
                o.text.toLowerCase().includes(v) || v.includes(o.text.toLowerCase().trim()) || o.value === value
              );
              if (match) { reactSet(sel, match.value); return true; }
            }
            return false;
          }, { v, value });
          if (foundAny) return true;
        }

        return false;
      } catch (e: any) {
        console.log(`[smartSelect] frame error: ${e.message}`);
        return false;
      }
    };

    // 1. حاول في الإطار الرئيسي أولاً
    const mainFrame = this.page.mainFrame();
    if (await tryInFrame(mainFrame)) return true;

    // 2. حاول في كل إطار فرعي (iframes)
    for (const frame of this.page.frames()) {
      if (frame === mainFrame) continue;
      if (await tryInFrame(frame)) return true;
    }

    // 3. محاولة النقر على radio button يطابق القيمة (مثلاً الجنس في فيسبوك)
    try {
      for (const frame of this.page.frames()) {
        const radioClicked = await frame.evaluate(({ v, value }) => {
          // ابحث عن radio buttons
          for (const radio of Array.from(document.querySelectorAll<HTMLInputElement>("input[type='radio']"))) {
            const lbl = radio.labels?.[0]?.textContent?.toLowerCase() || "";
            const ariaLabel = (radio.getAttribute("aria-label") || "").toLowerCase();
            const radioVal = (radio.value || "").toLowerCase();
            if (lbl.includes(v) || ariaLabel.includes(v) || radioVal === v || radioVal.includes(v) || v.includes(radioVal)) {
              radio.click();
              radio.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
            // أيضاً ابحث في النص المجاور للـ radio
            const parent = radio.parentElement;
            const parentText = (parent?.textContent || "").toLowerCase();
            if (parentText.includes(v) || v.includes(parentText.trim())) {
              radio.click();
              radio.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
          }
          return false;
        }, { v, value });
        if (radioClicked) {
          console.log(`[smartSelect] radio button clicked for "${value}"`);
          return true;
        }
      }
    } catch {}

    // 4. القوائم المنسدلة المخصصة (React Select, MUI, etc.)
    console.log(`[smartSelect] falling back to smartDropdown for hint="${hint}"`);
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
