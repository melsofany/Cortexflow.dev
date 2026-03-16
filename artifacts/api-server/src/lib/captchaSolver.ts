import https from "https";
import http from "http";

const POLL_INTERVAL = 5000;
const MAX_WAIT = 120000;

function request(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data.trim()));
    }).on("error", reject);
  });
}

function postForm(url: string, params: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    const urlObj = new URL(url);
    const mod = urlObj.protocol === "https:" ? https : http;
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = mod.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data.trim()));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function solveTwoCaptcha(apiKey: string, siteKey: string, pageUrl: string): Promise<string | null> {
  console.log("[2captcha] Submitting reCAPTCHA...");
  try {
    const submitRes = await postForm("http://2captcha.com/in.php", {
      key: apiKey,
      method: "userrecaptcha",
      googlekey: siteKey,
      pageurl: pageUrl,
      json: "0",
    });
    if (!submitRes.startsWith("OK|")) {
      console.error("[2captcha] Submit error:", submitRes);
      return null;
    }
    const taskId = submitRes.split("|")[1];
    console.log("[2captcha] Task ID:", taskId);
    const deadline = Date.now() + MAX_WAIT;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      const res = await request(`http://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}`);
      if (res === "CAPCHA_NOT_READY") continue;
      if (res.startsWith("OK|")) {
        const token = res.split("|")[1];
        console.log("[2captcha] Solved! Token length:", token.length);
        return token;
      }
      console.error("[2captcha] Error:", res);
      return null;
    }
    console.error("[2captcha] Timeout");
    return null;
  } catch (e: any) {
    console.error("[2captcha] Exception:", e.message);
    return null;
  }
}

async function solveCapSolver(apiKey: string, siteKey: string, pageUrl: string): Promise<string | null> {
  console.log("[capsolver] Submitting reCAPTCHA...");
  const createBody = JSON.stringify({
    clientKey: apiKey,
    task: {
      type: "ReCaptchaV2TaskProxyLess",
      websiteURL: pageUrl,
      websiteKey: siteKey,
    },
  });
  try {
    const createRes = await fetch("https://api.capsolver.com/createTask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: createBody,
    }).then(r => r.json()) as any;

    if (createRes.errorId !== 0) {
      console.error("[capsolver] Create error:", createRes.errorDescription);
      return null;
    }
    const taskId = createRes.taskId;
    console.log("[capsolver] Task ID:", taskId);
    const deadline = Date.now() + MAX_WAIT;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      const res = await fetch("https://api.capsolver.com/getTaskResult", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
      }).then(r => r.json()) as any;
      if (res.status === "processing") continue;
      if (res.status === "ready") {
        const token = res.solution?.gRecaptchaResponse;
        console.log("[capsolver] Solved! Token length:", token?.length);
        return token || null;
      }
      console.error("[capsolver] Error:", res.errorDescription);
      return null;
    }
    return null;
  } catch (e: any) {
    console.error("[capsolver] Exception:", e.message);
    return null;
  }
}

export async function solveCaptcha(siteKey: string, pageUrl: string): Promise<string | null> {
  const twoCaptchaKey = process.env.TWO_CAPTCHA_API_KEY;
  const capsolverKey  = process.env.CAPSOLVER_API_KEY;
  if (capsolverKey)  return solveCapSolver(capsolverKey, siteKey, pageUrl);
  if (twoCaptchaKey) return solveTwoCaptcha(twoCaptchaKey, siteKey, pageUrl);
  console.warn("[captchaSolver] No API key set (TWO_CAPTCHA_API_KEY or CAPSOLVER_API_KEY). Manual mode only.");
  return null;
}

export async function detectAndSolveRecaptcha(page: import("playwright").Page, emit?: (event: string, data: any) => void): Promise<boolean> {
  try {
    const frame = page.frames().find(f => f.url().includes("recaptcha") || f.url().includes("fbsbx.com/captcha"));
    if (!frame && !page.url().includes("recaptcha")) return false;

    const siteKey = await page.evaluate(() => {
      const el = document.querySelector('[data-sitekey]') as HTMLElement | null;
      if (el) return el.getAttribute('data-sitekey');
      const scripts = Array.from(document.querySelectorAll('script[src*="recaptcha"]'));
      return null;
    }).catch(() => null);

    if (!siteKey) {
      console.log("[captchaSolver] reCAPTCHA detected but no sitekey found. Waiting for manual solve.");
      return false;
    }

    console.log("[captchaSolver] reCAPTCHA sitekey:", siteKey);
    emit?.("agentLog", { type: "info", text: `🔐 كابتشا مكتشف — جاري الحل تلقائياً...` });

    const token = await solveCaptcha(siteKey, page.url());
    if (!token) {
      emit?.("agentLog", { type: "warn", text: `⚠️ لا يوجد مفتاح API للحل التلقائي — يُرجى حل الكابتشا يدوياً` });
      return false;
    }

    await page.evaluate((t) => {
      const textarea = document.querySelector('#g-recaptcha-response') as HTMLTextAreaElement | null;
      if (textarea) { textarea.value = t; textarea.style.display = 'block'; }
      const textarea2 = document.querySelector('textarea[name="g-recaptcha-response"]') as HTMLTextAreaElement | null;
      if (textarea2) { textarea2.value = t; }
      (window as any).___grecaptcha_cfg?.clients?.[0]?.aa?.l?.callback?.(t);
      (window as any).captchaCallback?.(t);
    }, token);

    await page.waitForTimeout(1000);
    emit?.("agentLog", { type: "success", text: `✅ تم حل الكابتشا تلقائياً` });
    return true;
  } catch (e: any) {
    console.error("[captchaSolver] Error:", e.message);
    return false;
  }
}
