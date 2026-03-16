"""
CortexFlow Agent Service — نظام وكيل ذكاء اصطناعي متكامل
=========================================================

نظام احترافي يشمل:
  1. توجيه ذكي للنماذج بحسب نوع المهمة
  2. تنفيذ متعدد المراحل (OODA Loop)
  3. ذاكرة ذاتية وتحسين مستمر
  4. نظام أدوات متكامل (كود، بحث، ملفات، رياضيات)
  5. تقييم ذاتي وتكيّف استراتيجي
"""

import os
import json
import asyncio
import subprocess
import tempfile
import math
import re
import time
import httpx
from datetime import datetime
from typing import TypedDict, Annotated, Sequence, Any
from collections import defaultdict
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages

OLLAMA_URL      = os.getenv("OLLAMA_URL", "http://localhost:11434")
PORT            = int(os.getenv("AGENT_SERVICE_PORT", "8090"))
DEEPSEEK_KEY    = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_URL    = "https://api.deepseek.com/v1/chat/completions"
DEEPSEEK_MODEL  = "deepseek-chat"

app = FastAPI(title="CortexFlow Agent Service — Professional AI System")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ══════════════════════════════════════════════════════════════════════════════
#  نظام الذاكرة والتحسين الذاتي
# ══════════════════════════════════════════════════════════════════════════════

class PerformanceMemory:
    """
    يتتبع أداء كل نموذج على كل نوع مهمة
    ويضبط الأوزان تلقائياً بناءً على النتائج
    """
    def __init__(self):
        self.model_scores: dict[str, dict[str, float]] = {}
        self.task_history: list[dict] = []
        self.strategy_adjustments: dict[str, str] = {}
        self.total_tasks = 0
        self.successful_tasks = 0

    def record_result(self, model: str, category: str, success: bool, duration: float, quality_score: float = 0.5):
        if model not in self.model_scores:
            self.model_scores[model] = {}
        
        key = category
        current = self.model_scores[model].get(key, 0.5)
        # التعلم التدريجي: تحديث النقطة بشكل تدريجي
        alpha = 0.3
        new_score = current * (1 - alpha) + (quality_score if success else 0.1) * alpha
        self.model_scores[model][key] = new_score
        
        self.task_history.append({
            "model": model,
            "category": category,
            "success": success,
            "duration": duration,
            "quality": quality_score,
            "timestamp": datetime.now().isoformat()
        })
        
        self.total_tasks += 1
        if success:
            self.successful_tasks += 1
        
        # احتفظ فقط بآخر 100 مهمة
        if len(self.task_history) > 100:
            self.task_history = self.task_history[-100:]

    def get_model_score(self, model: str, category: str) -> float:
        return self.model_scores.get(model, {}).get(category, 0.5)

    def get_stats(self) -> dict:
        success_rate = (self.successful_tasks / self.total_tasks * 100) if self.total_tasks > 0 else 0
        return {
            "total_tasks": self.total_tasks,
            "successful_tasks": self.successful_tasks,
            "success_rate": round(success_rate, 1),
            "model_performance": self.model_scores,
            "recent_tasks": self.task_history[-5:]
        }

    def generate_self_improvement_report(self) -> str:
        if not self.task_history:
            return "لم يتم تنفيذ أي مهام بعد."
        
        stats = self.get_stats()
        weak_areas = []
        strong_areas = []
        
        for model, cats in self.model_scores.items():
            for cat, score in cats.items():
                if score < 0.4:
                    weak_areas.append(f"{model} على {cat}: {score:.2f}")
                elif score > 0.7:
                    strong_areas.append(f"{model} على {cat}: {score:.2f}")
        
        report = f"""
=== تقرير التحسين الذاتي ===
معدل النجاح الإجمالي: {stats['success_rate']}%
المهام المنجزة: {stats['total_tasks']}

نقاط القوة:
{chr(10).join(strong_areas[:5]) if strong_areas else 'لا توجد بيانات كافية'}

مجالات تحتاج تحسيناً:
{chr(10).join(weak_areas[:5]) if weak_areas else 'الأداء متوازن'}
"""
        return report.strip()


# مثيل عالمي للذاكرة
memory = PerformanceMemory()


# ══════════════════════════════════════════════════════════════════════════════
#  تصنيف المهام والنماذج
# ══════════════════════════════════════════════════════════════════════════════

TASK_KEYWORDS = {
    "browser": [
        "افتح","تصفح","انتقل","موقع","اذهب","سجل","تسجيل",
        "facebook","twitter","instagram","youtube","google","يوتيوب",
        "ويب","web","url","http","احجز","اشتر",
    ],
    "code": [
        "اكتب كود","برمجة","كود","script","python","javascript","برنامج",
        "function","api","class","debug","typescript","sql","سكريبت",
        "أنشئ تطبيق","طوّر","ابرمج","اكتب دالة","اكتب برنامج",
    ],
    "research": [
        "ابحث","اشرح","ما هو","ما هي","كيف","لماذا","متى","أين",
        "معلومات","تحليل","قارن","مقارنة","دراسة","تقرير","ملخص",
        "explain","research","analyze","summary","وضّح","عرّف","فسّر",
    ],
    "creative": [
        "اكتب","قصة","مقال","قصيدة","محتوى","نص","وصف","إعلان",
        "write","story","article","blog","منشور","خطاب","رسالة",
        "أنشئ محتوى","حوار","سيناريو","نشيد",
    ],
    "math": [
        "احسب","حساب","معادلة","رياضيات","calculate","math","equation",
        "formula","percentage","نسبة","ناتج","جمع","طرح","ضرب","قسمة",
        "integral","derivative","statistics","جذر","قوة","لوغاريتم",
    ],
    "translation": [
        "ترجم","translation","translate","بالعربية","بالإنجليزية","اللغة",
        "ترجمة","انقل إلى","من العربي","إلى الإنجليزي","بالفرنسية",
    ],
    "reasoning": [
        "فكّر","استنتج","هل يمكن","ما الأفضل","قيّم","تقييم","قرار",
        "توصية","نصيحة","scenario","تحليل عميق","منطق","استنتج",
        "خطة استراتيجية","ماذا يحدث لو","قارن بين",
    ],
    "file": [
        "اقرأ ملف","اكتب ملف","احفظ","قراءة","كتابة","ملف","file",
        "directory","مجلد","path","json","csv","txt",
    ],
    "agent": [
        "خطط","نفّذ سلسلة","أنجز","حقق هدف","وكيل","agent",
        "متعدد الخطوات","خطة متكاملة","مشروع",
    ],
    "simple": [],
}

MODEL_BASE_SCORES: dict[str, dict[str, float]] = {
    "qwen2:0.5b":               {"browser":0.3,"code":0.4,"research":0.4,"creative":0.4,"math":0.4,"translation":0.8,"reasoning":0.3,"file":0.5,"agent":0.3,"simple":0.9},
    "qwen2.5:0.5b":             {"browser":0.3,"code":0.5,"research":0.4,"creative":0.4,"math":0.5,"translation":0.8,"reasoning":0.4,"file":0.5,"agent":0.3,"simple":0.9},
    "llama3.2:1b":              {"browser":0.7,"code":0.7,"research":0.7,"creative":0.7,"math":0.6,"translation":0.6,"reasoning":0.7,"file":0.7,"agent":0.7,"simple":0.6},
    "llama3.2:3b":              {"browser":0.8,"code":0.8,"research":0.8,"creative":0.8,"math":0.7,"translation":0.7,"reasoning":0.8,"file":0.8,"agent":0.8,"simple":0.6},
    "mistral:7b-instruct-q2_K": {"browser":0.5,"code":0.9,"research":0.9,"creative":0.8,"math":0.9,"translation":0.8,"reasoning":0.9,"file":0.8,"agent":0.9,"simple":0.4},
    "mistral:latest":           {"browser":0.5,"code":0.9,"research":0.9,"creative":0.8,"math":0.9,"translation":0.8,"reasoning":0.9,"file":0.8,"agent":0.9,"simple":0.4},
    "phi3:mini":                {"browser":0.5,"code":0.8,"research":0.8,"creative":0.7,"math":0.9,"translation":0.6,"reasoning":0.8,"file":0.7,"agent":0.7,"simple":0.5},
    "gemma2:2b":                {"browser":0.6,"code":0.7,"research":0.8,"creative":0.8,"math":0.7,"translation":0.7,"reasoning":0.7,"file":0.7,"agent":0.7,"simple":0.6},
}

PROVIDER_MODELS = {
    "QwenLM":          ["qwen2:0.5b", "qwen2.5:0.5b", "qwen2:1.5b"],
    "meta-llama":      ["llama3.2:3b", "llama3.2:1b", "llama3:8b"],
    "mistralai":       ["mistral:latest", "mistral:7b-instruct-q2_K", "mistral:7b"],
    "phi":             ["phi3:mini", "phi3:medium"],
    "google":          ["gemma2:2b", "gemma2:9b"],
    "AutoGPT":         ["llama3.2:3b", "llama3.2:1b"],
    "LangGraph":       ["llama3.2:3b", "mistral:latest"],
    "OpenInterpreter": ["llama3.2:3b", "mistral:latest"],
}


async def get_available_models() -> list[str]:
    try:
        async with httpx.AsyncClient() as c:
            r = await c.get(f"{OLLAMA_URL}/api/tags", timeout=5)
            return [m["name"] for m in r.json().get("models", [])]
    except Exception:
        return []


def classify_task(description: str, task_type: str = "") -> str:
    if task_type in TASK_KEYWORDS:
        return task_type
    text = description.lower()
    scores = {cat: 0.0 for cat in TASK_KEYWORDS}
    for cat, keywords in TASK_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in text:
                scores[cat] += 1.0
    if len(description.split()) <= 4:
        scores["simple"] += 2.0
    best = max(scores.items(), key=lambda x: x[1])
    return best[0] if best[1] > 0 else "simple"


def select_best_model(description: str, available: list[str], task_type: str = "") -> tuple[str, str, str]:
    category = classify_task(description, task_type)
    if not available:
        return ("llama3.2:1b", category, "لا نماذج مثبتة — سيتم التنزيل تلقائياً")
    
    best_model = available[0]
    best_score = -1.0
    
    for model in available:
        base = MODEL_BASE_SCORES.get(model, {}).get(category, 0.5)
        learned = memory.get_model_score(model, category)
        # مزج النقطة الأساسية مع التعلم المكتسب
        combined_score = base * 0.6 + learned * 0.4
        if combined_score > best_score:
            best_score = combined_score
            best_model = model
    
    reasons = {
        "browser":     "مهمة تصفح ويب — نموذج متخصص في التفاعل مع المواقع",
        "code":        "مهمة برمجية — نموذج متخصص في كتابة وتحليل الكود",
        "research":    "مهمة بحثية — نموذج ذو قدرة تحليلية عالية",
        "creative":    "مهمة إبداعية — نموذج ذو قدرة توليدية قوية",
        "math":        "مهمة رياضية — نموذج ذو دقة حسابية عالية",
        "translation": "مهمة ترجمة — نموذج متعدد اللغات",
        "reasoning":   "مهمة تفكير معقدة — أقوى نموذج متاح",
        "file":        "عمليات ملفات — نموذج يدعم التعامل مع البيانات",
        "agent":       "مهمة متعددة الخطوات — نموذج ذو قدرة تخطيطية عالية",
        "simple":      "مهمة بسيطة — نموذج سريع وكافٍ",
    }
    return (best_model, category, reasons.get(category, ""))


# ══════════════════════════════════════════════════════════════════════════════
#  نظام الأدوات (Tools)
# ══════════════════════════════════════════════════════════════════════════════

class Tool:
    """أداة قابلة للاستخدام من قِبَل الوكيل"""
    name: str
    description: str

    async def execute(self, params: dict) -> str:
        raise NotImplementedError


class CodeExecutorTool(Tool):
    name = "execute_code"
    description = "تنفيذ كود Python وإرجاع النتيجة"

    async def execute(self, params: dict) -> str:
        code = params.get("code", "")
        if not code:
            return "خطأ: لم يتم تقديم كود"
        
        with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
            f.write(code)
            fname = f.name
        
        try:
            result = subprocess.run(
                ["python3", fname],
                capture_output=True, text=True, timeout=30
            )
            output = result.stdout.strip()
            err = result.stderr.strip()
            if err and not output:
                return f"خطأ:\n{err}"
            return output or "تم التنفيذ بنجاح (لا مخرجات)"
        except subprocess.TimeoutExpired:
            return "انتهت مهلة التنفيذ (30 ثانية)"
        except Exception as e:
            return f"خطأ: {str(e)}"
        finally:
            import os
            try:
                os.unlink(fname)
            except:
                pass


class MathTool(Tool):
    name = "calculate"
    description = "حساب التعبيرات الرياضية بأمان"

    async def execute(self, params: dict) -> str:
        expr = params.get("expression", "")
        try:
            # بيئة آمنة للحسابات
            safe_globals = {
                "__builtins__": {},
                "math": math,
                "abs": abs, "round": round, "min": min, "max": max,
                "sum": sum, "pow": pow, "len": len,
                "int": int, "float": float, "str": str,
            }
            result = eval(expr, safe_globals)
            return str(result)
        except Exception as e:
            return f"خطأ في الحساب: {str(e)}"


class FileReadTool(Tool):
    name = "read_file"
    description = "قراءة محتوى ملف نصي"

    async def execute(self, params: dict) -> str:
        path = params.get("path", "")
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            return content[:3000] + ("..." if len(content) > 3000 else "")
        except Exception as e:
            return f"خطأ في القراءة: {str(e)}"


class FileWriteTool(Tool):
    name = "write_file"
    description = "كتابة محتوى إلى ملف"

    async def execute(self, params: dict) -> str:
        path = params.get("path", "")
        content = params.get("content", "")
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            return f"تم الكتابة بنجاح إلى: {path}"
        except Exception as e:
            return f"خطأ في الكتابة: {str(e)}"


class WebSearchTool(Tool):
    name = "web_search"
    description = "البحث عن معلومات على الإنترنت"

    async def execute(self, params: dict) -> str:
        query = params.get("query", "")
        try:
            async with httpx.AsyncClient() as client:
                # استخدام DuckDuckGo API
                r = await client.get(
                    "https://api.duckduckgo.com/",
                    params={"q": query, "format": "json", "no_redirect": "1", "no_html": "1"},
                    timeout=10,
                    headers={"User-Agent": "CortexFlow/1.0"}
                )
                data = r.json()
                
                results = []
                if data.get("AbstractText"):
                    results.append(f"المعلومات: {data['AbstractText']}")
                if data.get("RelatedTopics"):
                    for topic in data["RelatedTopics"][:3]:
                        if isinstance(topic, dict) and topic.get("Text"):
                            results.append(f"- {topic['Text'][:200]}")
                
                return "\n".join(results) if results else f"لم أجد نتائج محددة لـ: {query}"
        except Exception as e:
            return f"تعذّر البحث: {str(e)}"


class ShellTool(Tool):
    name = "run_shell"
    description = "تنفيذ أمر shell آمن"
    
    ALLOWED_CMDS = ["ls", "pwd", "echo", "cat", "head", "tail", "grep", "wc", "date", "find"]

    async def execute(self, params: dict) -> str:
        cmd = params.get("command", "")
        base_cmd = cmd.split()[0] if cmd else ""
        
        if base_cmd not in self.ALLOWED_CMDS:
            return f"الأمر '{base_cmd}' غير مسموح به. الأوامر المتاحة: {', '.join(self.ALLOWED_CMDS)}"
        
        try:
            result = subprocess.run(
                cmd, shell=True, capture_output=True, text=True, timeout=10
            )
            return result.stdout.strip() or result.stderr.strip() or "لا مخرجات"
        except Exception as e:
            return f"خطأ: {str(e)}"


class BrowserSelectTool(Tool):
    """
    أداة متخصصة للتعامل مع القوائم المنسدلة (<select>) في صفحات الويب.
    تحل مشكلة التمييز بين قوائم اليوم والشهر والسنة (مثل فيسبوك).
    """
    name = "browser_select"
    description = (
        "تعبئة قوائم منسدلة (<select>) في صفحة ويب مفتوحة بالمتصفح. "
        "مثالية لحقول تاريخ الميلاد (اليوم/الشهر/السنة) في فيسبوك وغيره. "
        "تقبل: url (اختياري), selects: قائمة من {selector, value, method}"
    )

    _DRIVER_CODE = """
import time, sys, os, shutil
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select, WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
import json

actions = {actions_json}
url     = {url_repr}

opts = Options()
opts.add_argument("--headless")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.add_argument("--disable-gpu")

# اكتشاف مسار Chrome/Chromium تلقائياً
chrome_paths = [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
]
for p in chrome_paths:
    if os.path.exists(p):
        opts.binary_location = p
        break

driver = webdriver.Chrome(options=opts)
wait   = WebDriverWait(driver, 15)
log    = []

try:
    if url:
        driver.get(url)
        time.sleep(2)

    for idx, act in enumerate(actions):
        sel      = act.get("selector", "")
        val      = act.get("value", "")
        method   = act.get("method", "auto")   # auto | by_text | by_value | by_index | nth_select
        nth      = act.get("nth", None)         # للاستخدام مع nth_select: 0=أول, 1=ثاني...
        wait_sec = float(act.get("wait_after", 0.5))

        # ── اختيار العنصر ──────────────────────────────────────────────
        if method == "nth_select" and nth is not None:
            # يختار القائمة حسب ترتيبها في الصفحة (0=الأولى)
            all_selects = driver.find_elements(By.TAG_NAME, "select")
            if nth >= len(all_selects):
                log.append(f"[{idx}] خطأ: لا يوجد select رقم {nth} (المتوفر: {len(all_selects)})")
                continue
            elem = all_selects[nth]
        elif sel.startswith("//") or sel.startswith("(//"):
            elem = wait.until(EC.presence_of_element_located((By.XPATH, sel)))
        else:
            elem = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, sel)))

        s = Select(elem)

        # ── طريقة الاختيار ──────────────────────────────────────────────
        if method == "by_index":
            s.select_by_index(int(val))
            log.append(f"[{idx}] اختار index={val} من القائمة")
        elif method == "by_value":
            s.select_by_value(str(val))
            log.append(f"[{idx}] اختار value='{val}' من القائمة")
        elif method == "by_text":
            s.select_by_visible_text(str(val))
            log.append(f"[{idx}] اختار نص='{val}' من القائمة")
        else:
            # auto: جرّب by_value أولاً ثم by_text
            try:
                s.select_by_value(str(val))
                log.append(f"[{idx}] اختار (value) '{val}'")
            except Exception:
                try:
                    s.select_by_visible_text(str(val))
                    log.append(f"[{idx}] اختار (text) '{val}'")
                except Exception as e2:
                    log.append(f"[{idx}] فشل الاختيار: {e2}")

        time.sleep(wait_sec)

    print("نجاح: " + " | ".join(log))

except Exception as e:
    print(f"خطأ: {{e}}")
finally:
    driver.quit()
"""

    async def execute(self, params: dict) -> str:
        url     = params.get("url", "")
        selects = params.get("selects", [])

        if not selects:
            return "خطأ: يجب تمرير قائمة selects"

        code = self._DRIVER_CODE.replace(
            "{actions_json}", json.dumps(selects, ensure_ascii=False),
        ).replace(
            "{url_repr}", repr(url),
        )

        with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False, encoding="utf-8") as f:
            f.write(code)
            fname = f.name

        try:
            result = subprocess.run(
                ["python3", fname],
                capture_output=True, text=True, timeout=60
            )
            out = result.stdout.strip()
            err = result.stderr.strip()
            if err and not out:
                return f"خطأ في التنفيذ:\n{err[:800]}"
            return out or "اكتمل التنفيذ بدون مخرجات"
        except subprocess.TimeoutExpired:
            return "انتهت المهلة (60 ثانية)"
        except Exception as e:
            return f"خطأ: {str(e)}"
        finally:
            try:
                os.unlink(fname)
            except:
                pass


class BrowserPageAnalyzerTool(Tool):
    """
    يقرأ الصفحة الحالية ويُعيد قائمة بجميع عناصر <select> مع خياراتها.
    يساعد الوكيل على فهم بنية النموذج قبل التعبئة.
    """
    name = "browser_analyze_selects"
    description = (
        "يفتح رابطاً ويُعيد قائمة بكل القوائم المنسدلة (<select>) الموجودة في الصفحة "
        "مع اسمها ومحتوياتها. استخدمه قبل browser_select لتحديد المحددات الصحيحة."
    )

    _ANALYZE_CODE = """
import time, json, os
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options

url = {url_repr}

opts = Options()
opts.add_argument("--headless")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.add_argument("--disable-gpu")

# اكتشاف مسار Chrome/Chromium تلقائياً
chrome_paths = [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
]
for p in chrome_paths:
    if os.path.exists(p):
        opts.binary_location = p
        break

driver = webdriver.Chrome(options=opts)
result = []

try:
    driver.get(url)
    time.sleep(2)
    
    selects = driver.find_elements(By.TAG_NAME, "select")
    for i, sel in enumerate(selects):
        name = sel.get_attribute("name") or ""
        id_  = sel.get_attribute("id") or ""
        opts_list = [o.text for o in sel.find_elements(By.TAG_NAME, "option")]
        result.append({{
            "index": i,
            "name": name,
            "id": id_,
            "options_count": len(opts_list),
            "sample_options": opts_list[:6],
        }})
    
    print(json.dumps(result, ensure_ascii=False, indent=2))
except Exception as e:
    print(f"خطأ: {{e}}")
finally:
    driver.quit()
"""

    async def execute(self, params: dict) -> str:
        url = params.get("url", "")
        if not url:
            return "خطأ: يجب تمرير url"

        code = self._ANALYZE_CODE.replace("{url_repr}", repr(url))

        with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False, encoding="utf-8") as f:
            f.write(code)
            fname = f.name

        try:
            result = subprocess.run(
                ["python3", fname],
                capture_output=True, text=True, timeout=45
            )
            out = result.stdout.strip()
            err = result.stderr.strip()
            return out if out else f"خطأ: {err[:500]}"
        except subprocess.TimeoutExpired:
            return "انتهت المهلة"
        except Exception as e:
            return f"خطأ: {str(e)}"
        finally:
            try:
                os.unlink(fname)
            except:
                pass


# تسجيل الأدوات
TOOLS: dict[str, Tool] = {
    "execute_code": CodeExecutorTool(),
    "calculate": MathTool(),
    "read_file": FileReadTool(),
    "write_file": FileWriteTool(),
    "web_search": WebSearchTool(),
    "run_shell": ShellTool(),
    "browser_select": BrowserSelectTool(),
    "browser_analyze_selects": BrowserPageAnalyzerTool(),
}

TOOLS_DESCRIPTION = "\n".join([
    f"- {name}: {tool.description}"
    for name, tool in TOOLS.items()
])


# ══════════════════════════════════════════════════════════════════════════════
#  استدعاء Ollama
# ══════════════════════════════════════════════════════════════════════════════

async def ollama_chat(
    model: str,
    messages: list[dict],
    max_tokens: int = 800,
    temperature: float = 0.3,
) -> str:
    async with httpx.AsyncClient() as c:
        try:
            r = await c.post(
                f"{OLLAMA_URL}/api/chat",
                json={
                    "model": model,
                    "messages": messages,
                    "stream": False,
                    "options": {"num_predict": max_tokens, "temperature": temperature},
                },
                timeout=180,
            )
            return r.json().get("message", {}).get("content", "")
        except Exception as e:
            return f"[خطأ في النموذج: {str(e)}]"


def _is_weak_response(text: str) -> bool:
    """هل الرد ضعيف أو فارغ ويحتاج مساعدة DeepSeek؟"""
    if not text or len(text.strip()) < 20:
        return True
    if text.strip().startswith("[خطأ في النموذج"):
        return True
    # ردود قصيرة جداً لا تفيد
    words = text.split()
    if len(words) < 5:
        return True
    return False


async def deepseek_chat(
    messages: list[dict],
    max_tokens: int = 1000,
    temperature: float = 0.3,
) -> str:
    """استدعاء DeepSeek"""
    if not DEEPSEEK_KEY:
        return ""
    try:
        async with httpx.AsyncClient() as c:
            r = await c.post(
                DEEPSEEK_URL,
                json={
                    "model": DEEPSEEK_MODEL,
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
                headers={
                    "Authorization": f"Bearer {DEEPSEEK_KEY}",
                    "Content-Type": "application/json",
                },
                timeout=60,
            )
            result = r.json()
            content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            print(f"[DeepSeek] استُخدم ({len(content)} حرف)")
            return content
    except Exception as e:
        print(f"[DeepSeek] فشل: {e}")
        return ""


async def deepseek_first_chat(
    messages: list[dict],
    max_tokens: int = 1000,
    temperature: float = 0.3,
    step_name: str = "",
) -> tuple[str, str]:
    """استدعاء DeepSeek أولاً (للمهام المعقدة كالمتصفح)، ثم Ollama احتياطاً"""
    if DEEPSEEK_KEY:
        ds_resp = await deepseek_chat(messages, max_tokens, temperature)
        if ds_resp and len(ds_resp.strip()) > 5:
            return ds_resp, "deepseek"

    available = await get_available_models()
    fallback_model = available[0] if available else "qwen2:0.5b"
    ollama_resp = await ollama_chat(fallback_model, messages, max_tokens, temperature)
    return ollama_resp or "جاري المعالجة...", "ollama"


async def smart_chat(
    model: str,
    messages: list[dict],
    max_tokens: int = 800,
    temperature: float = 0.3,
    step_name: str = "",
) -> tuple[str, str]:
    """
    استدعاء ذكي: Ollama أولاً، DeepSeek احتياطاً عند الضعف.
    يعيد (النص, المصدر) حيث المصدر = 'ollama' أو 'deepseek'
    """
    ollama_resp = await ollama_chat(model, messages, max_tokens, temperature)

    if not _is_weak_response(ollama_resp):
        return ollama_resp, "ollama"

    # الرد ضعيف → نطلب مساعدة DeepSeek
    if DEEPSEEK_KEY:
        step_hint = f"\n[ملاحظة: هذا هو دور الوكيل في مرحلة {step_name}]" if step_name else ""
        ds_messages = messages.copy()
        if step_hint and ds_messages:
            ds_messages = ds_messages[:-1] + [
                {**ds_messages[-1], "content": ds_messages[-1]["content"] + step_hint}
            ]
        ds_resp = await deepseek_chat(ds_messages, max_tokens, temperature)
        if ds_resp:
            return f"[🤖 DeepSeek] {ds_resp}", "deepseek"

    return ollama_resp or "جاري المعالجة...", "ollama"


async def sc(
    model: str,
    messages: list[dict],
    max_tokens: int = 800,
    temperature: float = 0.3,
    step_name: str = "",
) -> str:
    """غلاف مبسّط لـ smart_chat يُعيد النص فقط (للاستخدام في الوكلاء الداخلية)"""
    text, _ = await smart_chat(model, messages, max_tokens, temperature, step_name)
    return text


async def ollama_stream(model: str, messages: list[dict], max_tokens: int = 1000):
    """دفق الردود من النموذج"""
    async with httpx.AsyncClient() as c:
        async with c.stream(
            "POST",
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": model,
                "messages": messages,
                "stream": True,
                "options": {"num_predict": max_tokens, "temperature": 0.3},
            },
            timeout=180,
        ) as r:
            async for line in r.aiter_lines():
                if line:
                    try:
                        data = json.loads(line)
                        chunk = data.get("message", {}).get("content", "")
                        if chunk:
                            yield chunk
                    except:
                        pass


# ══════════════════════════════════════════════════════════════════════════════
#  1. OODA Agent — الوكيل الرئيسي الاحترافي
#  Observe → Orient → Decide → Act (مثل Manus/Claude)
# ══════════════════════════════════════════════════════════════════════════════

MASTER_SYSTEM_PROMPT = """أنت CortexFlow، وكيل ذكاء اصطناعي. أجب دائماً بنفس لغة المستخدم.

أدواتك:
{tools}

للاستخدام أداة:
TOOL: <اسم_الأداة>
PARAMS: {{"مفتاح": "قيمة"}}

للإنهاء:
RESULT: <النتيجة>

═══ تعليمات خاصة للقوائم المنسدلة (dropdowns) ═══
عند التعامل مع صفحات فيها قوائم منسدلة (<select>) مثل تاريخ الميلاد في فيسبوك:

1. استخدم browser_analyze_selects أولاً لتحليل الصفحة وفهم ترتيب القوائم.
2. استخدم browser_select مع method="nth_select" و nth=0 لليوم, nth=1 للشهر, nth=2 للسنة.
   - لا تستخدم محدد CSS عام ("select") لأنه يستهدف أول قائمة فقط.
   - كل قائمة يجب أن تُستهدف بشكل مستقل بـ nth الخاص بها.
3. مثال لتاريخ ميلاد في فيسبوك:
TOOL: browser_select
PARAMS: {{"url": "https://facebook.com/reg", "selects": [
  {{"method": "nth_select", "nth": 0, "value": "15", "method2": "by_value", "wait_after": 0.8}},
  {{"method": "nth_select", "nth": 1, "value": "Jan", "method2": "by_text", "wait_after": 0.8}},
  {{"method": "nth_select", "nth": 2, "value": "1990", "method2": "by_value", "wait_after": 0.5}}
]}}

تذكر: كل قائمة (يوم/شهر/سنة) عنصر منفصل يجب استهدافه بمنتهى الدقة.
""".format(tools=TOOLS_DESCRIPTION)

# Prompt مبسّط للمهام التي لا تحتاج أدوات
SIMPLE_SYSTEM_PROMPT = "أنت CortexFlow، مساعد ذكاء اصطناعي محترف. أجب دائماً بنفس لغة المستخدم. قدّم إجابة مباشرة وشاملة."

# الفئات التي تحتاج أدوات فقط
TOOL_CATEGORIES = {"code", "math", "file", "agent", "browser"}

# الفئات التي تُجاب مباشرة بدون OODA معقد
DIRECT_CATEGORIES = {"simple", "creative", "research", "translation", "reasoning"}


async def parse_and_execute_tool(response: str) -> tuple[str | None, str | None]:
    """استخراج وتنفيذ أداة من رد النموذج"""
    tool_match = re.search(r'TOOL:\s*(\w+)', response)
    params_match = re.search(r'PARAMS:\s*(\{.*?\})', response, re.DOTALL)
    
    if not tool_match:
        return None, None
    
    tool_name = tool_match.group(1).strip()
    params = {}
    
    if params_match:
        try:
            params = json.loads(params_match.group(1))
        except:
            params_text = params_match.group(1)
            kv_match = re.findall(r'"(\w+)":\s*"([^"]*)"', params_text)
            params = dict(kv_match)
    
    if tool_name not in TOOLS:
        return tool_name, f"الأداة '{tool_name}' غير موجودة. الأدوات المتاحة: {', '.join(TOOLS.keys())}"
    
    tool_result = await TOOLS[tool_name].execute(params)
    return tool_name, tool_result


async def ooda_agent(task: str, model: str, category: str, max_iterations: int = 8) -> dict:
    """
    OODA Loop Agent — وكيل ذكي يختار المسار المناسب حسب نوع المهمة:
    - المهام المباشرة (simple/creative/research/translation/reasoning): إجابة مباشرة
    - المهام المعقدة (code/math/file/agent): OODA كامل مع أدوات
    """
    steps = []
    start_time = time.time()
    final_result = ""
    iterations = 1

    # ══ المسار المباشر: للمهام التي لا تحتاج أدوات ══
    if category in DIRECT_CATEGORIES:
        system_prompt = SIMPLE_SYSTEM_PROMPT
        category_hints = {
            "simple":      "أجب بإيجاز ووضوح.",
            "creative":    "قدّم محتوى إبداعياً وأصيلاً ومنظماً.",
            "research":    "قدّم معلومات دقيقة وشاملة ومنظمة.",
            "translation": "قدّم الترجمة الدقيقة مباشرةً.",
            "reasoning":   "حلّل المسألة خطوة بخطوة ثم قدّم توصيتك.",
            "browser":     "اشرح ما يجب فعله للوصول للهدف.",
        }
        hint = category_hints.get(category, "")

        # خطوة واحدة: THINK
        think_resp, think_src = await smart_chat(model, [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"{task}\n\n{hint}"},
        ], max_tokens=600, temperature=0.3, step_name="THINK")
        src_tag = " [🤖DS]" if think_src == "deepseek" else ""
        steps.append(f"[THINK]{src_tag} {think_resp}")
        final_result = think_resp

        # خطوة اختيارية: تحسين الإجابة إذا كانت قصيرة جداً
        if len(final_result.split()) < 10 and category not in ("simple", "translation"):
            improve_resp, imp_src = await smart_chat(model, [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": task},
                {"role": "assistant", "content": final_result},
                {"role": "user", "content": "وسّع الإجابة أكثر وأضف تفاصيل مفيدة."},
            ], max_tokens=500, temperature=0.3, step_name="EXPAND")
            if len(improve_resp) > len(final_result):
                src_tag = " [🤖DS]" if imp_src == "deepseek" else ""
                steps.append(f"[EXPAND]{src_tag} {improve_resp}")
                final_result = improve_resp

    # ══ المسار المعقد: للمهام التي تحتاج أدوات وتخطيط ══
    else:
        # للمهام المعقدة (خاصةً المتصفح): استخدم DeepSeek مباشرةً كأول خيار
        use_deepseek_first = (category == "browser") and bool(DEEPSEEK_KEY)
        chat_fn = deepseek_first_chat if use_deepseek_first else (
            lambda msgs, max_tokens=800, temperature=0.3, step_name="": smart_chat(model, msgs, max_tokens, temperature, step_name)
        )

        messages = [{"role": "system", "content": MASTER_SYSTEM_PROMPT}]

        # Observe
        if category == "browser":
            observe_prompt = (
                f"المهمة: {task}\n\n"
                "⚠️ تعليمات مهمة لمهام المتصفح:\n"
                "1. لا تفترض أي حقول أو قوائم منسدلة قبل تحليل الصفحة الفعلية\n"
                "2. ابدأ دائماً بالتنقل إلى الرابط المطلوب\n"
                "3. استخدم browser_analyze_selects لرؤية ما هو موجود فعلاً في الصفحة قبل أي fill أو select\n"
                "4. فقط اعمل على الحقول التي تأكدت من وجودها في نتيجة التحليل\n"
                "5. القوائم المنسدلة: استهدفها بـ nth (0=الأولى, 1=الثانية...) بعد التحليل\n"
                f"\nالأدوات المتاحة: {', '.join(TOOLS.keys())}"
            )
        else:
            observe_prompt = f"المهمة: {task}\n\nحلّل ما المطلوب وهل تحتاج أداة من: {', '.join(TOOLS.keys())}"
        messages.append({"role": "user", "content": observe_prompt})
        observation, obs_src = await chat_fn(messages, max_tokens=400, step_name="OBSERVE")
        messages.append({"role": "assistant", "content": observation})
        src_tag = " [🤖DS]" if obs_src == "deepseek" else ""
        steps.append(f"[OBSERVE]{src_tag} {observation}")

        # Act loop
        for i in range(max_iterations):
            iterations = i + 1
            if i == 0:
                act_prompt = (
                    f"نفّذ المهمة الآن: {task}\n"
                    "إذا احتجت أداة:\nTOOL: <اسم>\nPARAMS: {\"مفتاح\": \"قيمة\"}\n"
                    "وإلا اكتب مباشرة:\nRESULT: <الإجابة الكاملة>"
                )
            else:
                act_prompt = "أكمل التنفيذ أو أعطِ:\nRESULT: <الإجابة الكاملة>"

            messages.append({"role": "user", "content": act_prompt})
            response, act_src = await chat_fn(
                messages, max_tokens=900, temperature=0.2, step_name=f"ACT-{i+1}"
            )
            if act_src == "deepseek":
                steps.append(f"[ACT:DS] DeepSeek يُنفذ")
            messages.append({"role": "assistant", "content": response})

            # أداة؟
            tool_name, tool_result = await parse_and_execute_tool(response)
            if tool_name and tool_result:
                steps.append(f"[TOOL:{tool_name}] {tool_result}")
                messages.append({
                    "role": "user",
                    "content": f"نتيجة الأداة:\n{tool_result}\n\nواصل أو أعطِ RESULT:"
                })
                continue

            # RESULT صريح؟
            result_match = re.search(r'RESULT:\s*(.+)', response, re.DOTALL)
            if result_match:
                final_result = result_match.group(1).strip()
                steps.append(f"[ACT-{i+1}] {response}")
                break

            steps.append(f"[ACT-{i+1}] {response}")

            # بعد التكرار الأول: إذا لم يستخدم أداة، الرد هو النتيجة
            if i >= 1 and not tool_name:
                final_result = response
                break

        if not final_result:
            final_result = steps[-1] if steps else "اكتمل التنفيذ"

    # ── مرحلة التحقق (Verify) ────────────────────────────────────────────
    if not final_result:
        final_result = "اكتمل التنفيذ"

    verify_msgs = [
        {"role": "system", "content": "أنت مراجع جودة. إذا كانت النتيجة جيدة قل 'مكتمل'. إذا كانت ناقصة حسّنها."},
        {"role": "user", "content": f"المهمة: {task}\nالنتيجة: {final_result[:600]}"}
    ]
    verification = await sc(model, verify_msgs, max_tokens=200, step_name="VERIFY")
    # إذا كانت مراجعة الجودة أطول وأفضل، استخدمها كنتيجة نهائية
    if len(verification) > len(final_result) and "مكتمل" not in verification[:20]:
        final_result = verification
    steps.append(f"[VERIFY] {verification}")

    duration = time.time() - start_time
    # نجاح حقيقي: أي نتيجة غير فارغة (حتى الأرقام القصيرة صحيحة)
    success = bool(final_result) and len(final_result.strip()) > 0

    # تقييم الجودة: نسبة بناءً على الطول مع حد أدنى لضمان التقييم العادل
    raw_quality = len(final_result) / 200
    quality = max(0.3, min(1.0, raw_quality)) if success else 0.1
    memory.record_result(model, category, success, duration, quality)

    return {
        "steps": steps,
        "result": final_result,
        "verification": verification,
        "duration": duration,
        "iterations": iterations,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  2. LangGraph Agent — وكيل متعدد العقد
# ══════════════════════════════════════════════════════════════════════════════

class AgentState(TypedDict):
    messages:  Annotated[Sequence[BaseMessage], add_messages]
    task:      str
    model:     str
    category:  str
    steps:     list[str]
    result:    str
    done:      bool
    retries:   int
    tool_results: list[str]


def build_langgraph_agent(model_name: str, category: str):
    """LangGraph pipeline: observe → think → plan → act → verify"""

    async def observe_node(state: AgentState) -> dict:
        r = await sc(model_name, [
            {"role": "system", "content": f"أنت وكيل ذكاء اصطناعي متخصص في مهام {category}. حلّل المهمة بعمق."},
            {"role": "user", "content": f"المهمة: {state['task']}\nما المتطلبات الجوهرية والتحديات المتوقعة؟"},
        ], max_tokens=350, step_name="OBSERVE")
        return {"steps": state["steps"] + [f"[OBSERVE] {r}"], "messages": [AIMessage(content=r)]}

    async def think_node(state: AgentState) -> dict:
        history = [{"role": "system", "content": "أنت خبير تحليل استراتيجي."}]
        for m in list(state["messages"])[-4:]:
            history.append({"role": "assistant" if isinstance(m, AIMessage) else "user", "content": m.content})
        history.append({"role": "user", "content": "ما أفضل نهج لتنفيذ هذه المهمة بالكامل؟ فكّر بعمق."})
        r = await sc(model_name, history, max_tokens=350, step_name="THINK")
        return {"steps": state["steps"] + [f"[THINK] {r}"], "messages": [AIMessage(content=r)]}

    async def plan_node(state: AgentState) -> dict:
        r = await sc(model_name, [
            {"role": "system", "content": "أنت مخطط مهام دقيق. ضع خطة واضحة ومتسلسلة."},
            {"role": "user", "content": f"المهمة: {state['task']}\nضع خطة تنفيذ مفصّلة ومرقّمة."},
        ], max_tokens=300, step_name="PLAN")
        return {"steps": state["steps"] + [f"[PLAN] {r}"], "messages": [AIMessage(content=r)]}

    async def act_node(state: AgentState) -> dict:
        context = ""
        if state.get("tool_results"):
            context = f"\n\nنتائج الأدوات:\n" + "\n".join(state["tool_results"][-2:])
        
        r = await sc(model_name, [
            {"role": "system", "content": f"أنت منفذ مهام محترف متخصص في {category}. قدّم النتيجة الفعلية الكاملة."},
            {"role": "user", "content": f"نفّذ هذه المهمة بالكامل وأعطِ النتيجة الشاملة:\n{state['task']}{context}"},
        ], max_tokens=800, temperature=0.2, step_name="ACT")
        
        # محاولة تنفيذ أداة إذا طُلبت
        tool_name, tool_result = await parse_and_execute_tool(r)
        tool_results = state.get("tool_results", [])
        if tool_result:
            tool_results = tool_results + [f"{tool_name}: {tool_result}"]
        
        return {
            "steps": state["steps"] + [f"[ACT] {r}"],
            "result": r,
            "messages": [AIMessage(content=r)],
            "tool_results": tool_results,
        }

    async def verify_node(state: AgentState) -> dict:
        r = await sc(model_name, [
            {"role": "system", "content": "أنت مراجع جودة دقيق."},
            {"role": "user", "content": f"المهمة: {state['task']}\nالنتيجة:\n{state['result']}\n\nهل اكتملت المهمة بالكامل؟ قيّم وحسّن."},
        ], max_tokens=300, step_name="VERIFY")
        complete = any(w in r for w in ["نعم", "اكتمل", "تم", "yes", "complete", "done", "مكتمل"])
        return {
            "steps": state["steps"] + [f"[VERIFY] {r}"],
            "result": r,
            "done": True,
            "retries": state["retries"],
            "messages": [AIMessage(content=r)],
        }

    def should_retry(state: AgentState) -> str:
        if not state.get("done") and state.get("retries", 0) < 2:
            return "act"
        return END

    graph = StateGraph(AgentState)
    graph.add_node("observe", observe_node)
    graph.add_node("think",   think_node)
    graph.add_node("plan",    plan_node)
    graph.add_node("act",     act_node)
    graph.add_node("verify",  verify_node)

    graph.set_entry_point("observe")
    graph.add_edge("observe", "think")
    graph.add_edge("think",   "plan")
    graph.add_edge("plan",    "act")
    graph.add_edge("act",     "verify")
    graph.add_conditional_edges("verify", should_retry, {"act": "act", END: END})

    return graph.compile()


# ══════════════════════════════════════════════════════════════════════════════
#  3. AutoGPT Agent — وكيل ذاتي التوجيه مع ذاكرة
# ══════════════════════════════════════════════════════════════════════════════

class AutoGPTMemory:
    def __init__(self):
        self.observations: list[str] = []
        self.completed_tasks: list[str] = []
        self.pending_tasks: list[str] = []
        self.tool_outputs: list[str] = []
        self.final_result: str = ""

    def summary(self) -> str:
        obs = "\n".join(self.observations[-3:]) if self.observations else "لا يوجد"
        done = "\n".join(f"✓ {t}" for t in self.completed_tasks) or "لا يوجد"
        pending = "\n".join(f"○ {t}" for t in self.pending_tasks[:3]) or "لا يوجد"
        tools = "\n".join(self.tool_outputs[-2:]) if self.tool_outputs else ""
        result = f"الملاحظات:\n{obs}\n\nالمنجز:\n{done}\n\nالمعلق:\n{pending}"
        if tools:
            result += f"\n\nنتائج الأدوات:\n{tools}"
        return result


async def autogpt_agent(task: str, model: str, category: str, max_iterations: int = 6) -> dict:
    """AutoGPT-inspired agent with memory, tools, and self-critique"""
    memory_obj = AutoGPTMemory()
    steps: list[str] = []
    start_time = time.time()

    # تحليل وتقسيم الهدف
    decompose_resp = await sc(model, [
        {"role": "system", "content": f"""أنت AutoGPT، وكيل ذاتي التوجيه متخصص في مهام {category}.
الأدوات المتاحة:
{TOOLS_DESCRIPTION}

قسّم الهدف إلى 3-5 مهام صغيرة قابلة للتنفيذ. اكتبها كقائمة مرقمة فقط."""},
        {"role": "user", "content": f"الهدف: {task}\nقسّمه:"},
    ], max_tokens=300, temperature=0.2, step_name="DECOMPOSE")

    subtasks = []
    for line in decompose_resp.strip().split("\n"):
        line = line.strip()
        if line and (line[0].isdigit() or line.startswith("-") or line.startswith("•")):
            cleaned = line.lstrip("0123456789.-•) ").strip()
            if cleaned:
                subtasks.append(cleaned)

    if not subtasks:
        subtasks = [task]

    memory_obj.pending_tasks = subtasks.copy()
    steps.append(f"[DECOMPOSE] تقسيم إلى {len(subtasks)} مهام:\n" + "\n".join(f"  {i+1}. {t}" for i, t in enumerate(subtasks)))

    for iteration in range(min(max_iterations, len(subtasks) + 1)):
        if not memory_obj.pending_tasks:
            break

        current_task = memory_obj.pending_tasks.pop(0)
        context = memory_obj.summary()

        exec_resp = await sc(model, [
            {"role": "system", "content": f"""أنت AutoGPT تنفّذ مهمة ضمن هدف أكبر.
الهدف الرئيسي: {task}
ذاكرتك:
{context}

إذا احتجت أداة:
TOOL: <اسم>
PARAMS: {{"مفتاح": "قيمة"}}"""},
            {"role": "user", "content": f"نفّذ: {current_task}"},
        ], max_tokens=500, temperature=0.3, step_name=f"STEP-{iteration+1}")

        tool_name, tool_result = await parse_and_execute_tool(exec_resp)
        if tool_result:
            memory_obj.tool_outputs.append(f"{tool_name}: {tool_result[:200]}")
            exec_resp = f"{exec_resp}\n\nنتيجة الأداة:\n{tool_result}"

        memory_obj.observations.append(f"'{current_task}': {exec_resp[:150]}...")
        memory_obj.completed_tasks.append(current_task)

        critique = await sc(model, [
            {"role": "system", "content": "قيّم النتيجة: هل تكفي؟ نعم/لا + ملاحظة موجزة."},
            {"role": "user", "content": f"المهمة: {current_task}\nالنتيجة: {exec_resp[:300]}\nالتقييم:"},
        ], max_tokens=80, temperature=0.1, step_name="CRITIQUE")

        steps.append(f"[STEP-{iteration+1}] {current_task}\n→ {exec_resp[:300]}\n⚡ {critique}")

    synthesis = await sc(model, [
        {"role": "system", "content": "لخّص إنجازات الوكيل في إجابة شاملة ومنظمة نهائية."},
        {"role": "user", "content": f"الهدف: {task}\nما تم إنجازه:\n{memory_obj.summary()}\nالملخص النهائي:"},
    ], max_tokens=600, temperature=0.2, step_name="SYNTHESIS")

    steps.append(f"[SYNTHESIS] {synthesis}")
    duration = time.time() - start_time
    
    quality = min(1.0, len(synthesis) / 300)
    memory.record_result(model, category, True, duration, quality)

    return {"steps": steps, "result": synthesis}


# ══════════════════════════════════════════════════════════════════════════════
#  4. Open Interpreter Agent — منفّذ الكود
# ══════════════════════════════════════════════════════════════════════════════

async def code_interpreter_agent(task: str, model: str) -> dict:
    """وكيل تنفيذ الكود المباشر"""
    steps: list[str] = []
    steps.append(f"[CODE-INTERPRETER] نموذج: {model}")

    # توليد الكود
    code_resp = await sc(model, [
        {"role": "system", "content": """أنت مبرمج Python خبير.
اكتب كوداً قابلاً للتشغيل مباشرةً لتنفيذ المهمة.
أحط الكود بـ ```python و```.
لا تضف شرحاً قبل الكود."""},
        {"role": "user", "content": f"المهمة: {task}\nالكود:"},
    ], max_tokens=800, temperature=0.1, step_name="GENERATE")

    steps.append(f"[GENERATE] {code_resp}")

    # استخراج الكود
    code_match = re.search(r'```python\n(.*?)```', code_resp, re.DOTALL)
    if not code_match:
        code_match = re.search(r'```\n(.*?)```', code_resp, re.DOTALL)

    if code_match:
        code = code_match.group(1).strip()
        executor = CodeExecutorTool()
        result = await executor.execute({"code": code})
        steps.append(f"[EXECUTE]\nالكود:\n{code}\n\nالمخرجات:\n{result}")

        # تحليل النتيجة
        analysis = await sc(model, [
            {"role": "system", "content": "حلّل مخرجات الكود وفسّرها."},
            {"role": "user", "content": f"المهمة: {task}\nالكود:\n{code}\nالمخرجات:\n{result}\nالتفسير:"},
        ], max_tokens=300, step_name="ANALYZE")
        steps.append(f"[ANALYZE] {analysis}")

        return {"steps": steps, "result": f"الكود:\n```python\n{code}\n```\n\nالمخرجات:\n{result}\n\nالتحليل:\n{analysis}"}

    return {"steps": steps, "result": code_resp}


# ══════════════════════════════════════════════════════════════════════════════
#  5. Mistral Agent — وكيل Mistral المتخصص
# ══════════════════════════════════════════════════════════════════════════════

async def mistral_agent(task: str, model: str, category: str) -> dict:
    steps: list[str] = []

    analyze_msgs = [
        {"role": "user", "content": f"[INST] أنت Mistral AI، خبير في مهام {category}. حلّل هذه المهمة وضع خطة:\n{task} [/INST]"}
    ]
    analysis = await sc(model, analyze_msgs, max_tokens=400, temperature=0.3, step_name="MISTRAL:ANALYZE")
    steps.append(f"[MISTRAL:ANALYZE] {analysis}")

    execute_msgs = [
        {"role": "user", "content": f"[INST] المهمة: {task}\nالتحليل: {analysis}\nنفّذ الآن وأعطِ النتيجة الكاملة والدقيقة. [/INST]"}
    ]
    result = await sc(model, execute_msgs, max_tokens=800, temperature=0.15, step_name="MISTRAL:EXECUTE")
    steps.append(f"[MISTRAL:EXECUTE] {result}")

    verify_msgs = [
        {"role": "user", "content": f"[INST] راجع النتيجة وتحقق من اكتمالها:\n{result[:400]}\n\nهل هي كاملة ودقيقة؟ حسّن إن لزم. [/INST]"}
    ]
    final = await sc(model, verify_msgs, max_tokens=300, temperature=0.1, step_name="MISTRAL:VERIFY")
    steps.append(f"[MISTRAL:VERIFY] {final}")

    return {"steps": steps, "result": final}


# ══════════════════════════════════════════════════════════════════════════════
#  نظام التنزيل التلقائي للنماذج
# ══════════════════════════════════════════════════════════════════════════════

RECOMMENDED_MODELS = [
    ("qwen2:0.5b",   "مهام بسيطة وترجمة سريعة",      352),
    ("llama3.2:1b",  "مهام عامة متوازنة",             1300),
    ("llama3.2:3b",  "مهام معقدة ومتوسطة",            2000),
    ("gemma2:2b",    "بحث وإبداع واستدلال عميق",      1600),
]


async def ensure_model_available(model_name: str) -> bool:
    """تنزيل نموذج إذا لم يكن متاحاً"""
    available = await get_available_models()
    if model_name in available:
        return True
    
    try:
        proc = await asyncio.create_subprocess_exec(
            "ollama", "pull", model_name,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await asyncio.wait_for(proc.wait(), timeout=600)
        return proc.returncode == 0
    except Exception:
        return False


# ══════════════════════════════════════════════════════════════════════════════
#  API Endpoints
# ══════════════════════════════════════════════════════════════════════════════

class TaskRequest(BaseModel):
    task:      str
    provider:  str = "auto"
    model:     str | None = None
    task_type: str = ""


class TaskResponse(BaseModel):
    provider:  str
    model:     str
    category:  str
    steps:     list[str]
    result:    str
    duration:  float = 0.0


class ModelPullRequest(BaseModel):
    model: str


@app.get("/health")
async def health():
    available = await get_available_models()
    stats = memory.get_stats()
    return {
        "status": "healthy",
        "models_available": len(available),
        "models": available,
        "performance": stats,
        "tools": list(TOOLS.keys()),
        "self_improvement_report": memory.generate_self_improvement_report(),
    }


@app.get("/models")
async def list_models():
    available = await get_available_models()
    recommended = []
    for name, desc, size_mb in RECOMMENDED_MODELS:
        installed = name in available
        recommended.append({
            "name": name,
            "description": desc,
            "size_mb": size_mb,
            "installed": installed,
        })
    return {"available": available, "recommended": recommended}


@app.post("/models/pull")
async def pull_model(req: ModelPullRequest):
    """تنزيل نموذج في الخلفية"""
    async def do_pull():
        await ensure_model_available(req.model)
    
    asyncio.create_task(do_pull())
    return {"status": "pulling", "model": req.model, "message": f"جاري تنزيل {req.model}..."}


@app.post("/run", response_model=TaskResponse)
async def run_task(req: TaskRequest):
    available = await get_available_models()
    
    if req.model:
        chosen_model = req.model
        category = classify_task(req.task, req.task_type)
        reason = "نموذج محدد يدوياً"
    else:
        chosen_model, category, reason = select_best_model(req.task, available, req.task_type)
    
    # تنزيل النموذج إذا لم يكن متاحاً
    if chosen_model not in available and available:
        chosen_model = available[0]
    elif not available:
        return TaskResponse(
            provider="error",
            model="none",
            category="error",
            steps=["[ERROR] لا يوجد نماذج مثبتة. يرجى تنزيل نموذج أولاً."],
            result="لا توجد نماذج. استخدم /models/pull لتنزيل نموذج.",
        )

    # اختيار المزود الأفضل بحسب المهمة أو الطلب
    provider = req.provider
    if provider == "auto":
        if category == "code":
            provider = "OpenInterpreter"
        elif category in ["reasoning", "math", "research"] and any("mistral" in m for m in available):
            provider = "Mistral"
        elif category in ["agent", "complex"]:
            provider = "LangGraph"
        else:
            provider = "OODA"

    try:
        start = time.time()

        if provider == "LangGraph":
            graph = build_langgraph_agent(chosen_model, category)
            init_state: AgentState = {
                "messages": [HumanMessage(content=req.task)],
                "task": req.task, "model": chosen_model, "category": category,
                "steps": [], "result": "", "done": False, "retries": 0, "tool_results": []
            }
            final_state = await graph.ainvoke(init_state)
            result_data = {"steps": final_state["steps"], "result": final_state["result"]}

        elif provider == "AutoGPT":
            result_data = await autogpt_agent(req.task, chosen_model, category)

        elif provider == "OpenInterpreter":
            result_data = await code_interpreter_agent(req.task, chosen_model)

        elif provider == "Mistral":
            mistral_model = next((m for m in available if "mistral" in m.lower()), chosen_model)
            result_data = await mistral_agent(req.task, mistral_model, category)

        else:  # OODA (الافتراضي — الأكثر احترافية)
            result_data = await ooda_agent(req.task, chosen_model, category)

        duration = time.time() - start

        return TaskResponse(
            provider=provider,
            model=chosen_model,
            category=category,
            steps=result_data.get("steps", []),
            result=result_data.get("result", ""),
            duration=round(duration, 2),
        )

    except Exception as e:
        return TaskResponse(
            provider=provider,
            model=chosen_model,
            category=category,
            steps=[f"[ERROR] {str(e)}"],
            result=f"خطأ في التنفيذ: {str(e)}",
        )


@app.get("/providers")
async def get_providers():
    available = await get_available_models()
    return {
        "providers": [
            {"id": "auto",            "name": "تلقائي (الأذكى)",     "description": "يختار المزود والنموذج الأمثل تلقائياً"},
            {"id": "OODA",            "name": "OODA Agent",           "description": "وكيل احترافي: مراقبة → توجه → قرار → تنفيذ"},
            {"id": "LangGraph",       "name": "LangGraph Pipeline",   "description": "خط أنابيب متعدد العقد مع إعادة المحاولة"},
            {"id": "AutoGPT",         "name": "AutoGPT Memory",       "description": "وكيل ذاتي التوجيه مع ذاكرة وتقييم ذاتي"},
            {"id": "OpenInterpreter", "name": "Code Interpreter",     "description": "منفذ كود Python مع تحليل النتائج"},
            {"id": "Mistral",         "name": "Mistral Specialist",   "description": "وكيل Mistral المتخصص في التفكير والبرمجة"},
        ],
        "available_models": available,
        "model_scores": memory.model_scores,
    }


@app.get("/self-improvement")
async def self_improvement():
    """تقرير التحسين الذاتي ونصائح الأداء"""
    report = memory.generate_self_improvement_report()
    stats = memory.get_stats()
    available = await get_available_models()
    
    suggestions = []
    if not available:
        suggestions.append("تنزيل نماذج: ابدأ بـ qwen2:0.5b و llama3.2:1b")
    if len(available) < 2:
        suggestions.append("تنويع النماذج لتغطية أفضل لأنواع المهام")
    if stats["total_tasks"] == 0:
        suggestions.append("نفّذ بعض المهام لبدء التعلم الذاتي")
    
    return {
        "report": report,
        "stats": stats,
        "suggestions": suggestions,
        "available_models": available,
    }


@app.post("/tools/{tool_name}")
async def use_tool(tool_name: str, params: dict):
    """استخدام أداة مباشرةً"""
    if tool_name not in TOOLS:
        raise HTTPException(status_code=404, detail=f"الأداة '{tool_name}' غير موجودة")
    result = await TOOLS[tool_name].execute(params)
    return {"tool": tool_name, "result": result}


@app.get("/tools")
async def list_tools():
    return {
        "tools": [
            {"name": name, "description": tool.description}
            for name, tool in TOOLS.items()
        ]
    }


# ── تنزيل تلقائي للنماذج الأساسية عند بدء التشغيل ──────────────────────────
@app.on_event("startup")
async def startup_event():
    print("[CortexFlow] بدء تشغيل نظام الوكيل الاحترافي...")
    available = await get_available_models()
    print(f"[CortexFlow] النماذج المتاحة: {available}")
    
    if not available:
        print("[CortexFlow] لا توجد نماذج — جاري تنزيل qwen2:0.5b...")
        asyncio.create_task(ensure_model_available("qwen2:0.5b"))
    
    print(f"[CortexFlow] الأدوات المتاحة: {list(TOOLS.keys())}")
    print("[CortexFlow] النظام جاهز للعمل!")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
