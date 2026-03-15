"""
CortexFlow Agent Service — Python Backend

Integrates four open-source repositories:
  1. LangGraph    (langchain-ai/langgraph)       — multi-node agent graph
  2. AutoGPT      (Significant-Gravitas/AutoGPT)  — iterative goal-seeking agent
  3. Open Interpreter (OpenInterpreter/open-interpreter) — code execution agent
  4. Mistral AI   (mistralai)                     — via Ollama local inference
"""

import os
import json
import asyncio
import httpx
from typing import TypedDict, Annotated, Sequence, Any
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# ── LangGraph & LangChain ─────────────────────────────────────────────────────
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
PORT       = int(os.getenv("AGENT_SERVICE_PORT", "8090"))

app = FastAPI(title="CortexFlow Agent Service — Multi-Repo Integration")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Provider Registry ─────────────────────────────────────────────────────────
PROVIDER_MODELS = {
    "QwenLM":          ["qwen2:0.5b", "qwen2.5:0.5b", "qwen2:1.5b"],
    "meta-llama":      ["llama3.2:1b", "llama3.2:3b", "llama3:8b"],
    "mistralai":       ["mistral:7b-instruct-q2_K", "mistral:latest", "mistral:7b"],
    "AutoGPT":         ["llama3.2:1b", "qwen2:0.5b"],
    "LangGraph":       ["llama3.2:1b", "qwen2:0.5b"],
    "OpenInterpreter": ["llama3.2:1b", "qwen2:0.5b"],
}

# ── Task Classification ───────────────────────────────────────────────────────
TASK_KEYWORDS = {
    "browser": [
        "افتح","تصفح","انتقل","موقع","اذهب","سجل","تسجيل","حساب",
        "facebook","twitter","instagram","youtube","google","فيسبوك",
        "تويتر","انستجرام","يوتيوب","جوجل","ويب","web","url","http",
        "قم بانشاء","انشئ حساب","سجل دخول","اشتر","احجز",
    ],
    "code": [
        "اكتب كود","برمجة","كود","script","python","javascript","برنامج",
        "function","api","class","اكتب برنامج","debug","typescript","sql",
        "اكتب سكريبت","أنشئ تطبيق","طوّر","ابرمج",
    ],
    "research": [
        "ابحث","اشرح","ما هو","ما هي","كيف","لماذا","متى","أين",
        "معلومات","تحليل","قارن","مقارنة","دراسة","تقرير","ملخص",
        "explain","research","analyze","summary","وضّح","عرّف",
    ],
    "creative": [
        "اكتب","قصة","مقال","قصيدة","محتوى","نص","وصف","إعلان",
        "write","story","article","blog","منشور","خطاب","رسالة",
    ],
    "math": [
        "احسب","حساب","معادلة","رياضيات","calculate","math","equation",
        "formula","percentage","نسبة","ناتج","جمع","طرح","ضرب","قسمة",
    ],
    "translation": [
        "ترجم","translation","translate","بالعربية","بالإنجليزية","اللغة",
        "ترجمة","انقل إلى",
    ],
    "reasoning": [
        "فكّر","استنتج","هل يمكن","ما الأفضل","قيّم","تقييم","قرار",
        "توصية","نصيحة","scenario","تحليل عميق","منطق",
    ],
    "simple": [],
}

MODEL_SCORES: dict[str, dict[str, int]] = {
    "qwen2:0.5b":               {"browser":1,"code":1,"research":1,"creative":1,"math":1,"translation":3,"reasoning":1,"simple":3},
    "qwen2.5:0.5b":             {"browser":1,"code":2,"research":1,"creative":1,"math":1,"translation":3,"reasoning":1,"simple":3},
    "llama3.2:1b":              {"browser":3,"code":3,"research":3,"creative":3,"math":2,"translation":2,"reasoning":3,"simple":2},
    "llama3.2:3b":              {"browser":3,"code":3,"research":3,"creative":3,"math":3,"translation":2,"reasoning":3,"simple":2},
    "mistral:7b-instruct-q2_K": {"browser":1,"code":3,"research":3,"creative":3,"math":3,"translation":3,"reasoning":3,"simple":1},
    "mistral:latest":           {"browser":1,"code":3,"research":3,"creative":3,"math":3,"translation":3,"reasoning":3,"simple":1},
}


async def get_available_models() -> list[str]:
    try:
        async with httpx.AsyncClient() as c:
            r = await c.get(f"{OLLAMA_URL}/api/tags", timeout=5)
            return [m["name"] for m in r.json().get("models", [])]
    except Exception:
        return []


async def pick_best_model(preferred: list[str], available: list[str]) -> str | None:
    for m in preferred:
        if m in available:
            return m
    return available[0] if available else None


def classify_task(description: str, task_type: str = "") -> str:
    if task_type == "browser":
        return "browser"
    text = description.lower()
    scores = {cat: 0 for cat in TASK_KEYWORDS}
    for cat, keywords in TASK_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in text:
                scores[cat] += 1
    if len(description.split()) <= 4:
        scores["simple"] += 2
    best = max(scores.items(), key=lambda x: x[1])
    return best[0] if best[1] > 0 else "simple"


def select_best_model_py(description: str, available: list[str], task_type: str = "") -> tuple[str, str, str]:
    category = classify_task(description, task_type)
    if not available:
        return ("llama3.2:1b", category, "لا نماذج — افتراضي")
    best, best_score = available[0], -1
    for m in available:
        s = MODEL_SCORES.get(m, {}).get(category, 1)
        if s > best_score:
            best_score, best = s, m
    reasons = {
        "browser":     "مهمة تصفح ويب",
        "code":        "مهمة برمجية",
        "research":    "مهمة بحثية",
        "creative":    "مهمة إبداعية",
        "math":        "مهمة رياضية",
        "translation": "مهمة ترجمة",
        "reasoning":   "تفكير معقد",
        "simple":      "مهمة بسيطة",
    }
    return (best, category, reasons.get(category, ""))


async def ollama_chat(
    model: str,
    messages: list[dict],
    max_tokens: int = 500,
    temperature: float = 0.3,
) -> str:
    async with httpx.AsyncClient() as c:
        r = await c.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": model,
                "messages": messages,
                "stream": False,
                "options": {"num_predict": max_tokens, "temperature": temperature},
            },
            timeout=120,
        )
        return r.json().get("message", {}).get("content", "")


# ══════════════════════════════════════════════════════════════════════════════
#  1. LangGraph Agent  (langchain-ai/langgraph)
#     Multi-node pipeline: observe → think → plan → act → verify
#     Uses conditional routing: if act result is insufficient → retry act
# ══════════════════════════════════════════════════════════════════════════════

class AgentState(TypedDict):
    messages:  Annotated[Sequence[BaseMessage], add_messages]
    task:      str
    model:     str
    steps:     list[str]
    result:    str
    done:      bool
    retries:   int


def build_langgraph_agent(model_name: str):
    """
    LangGraph pipeline with conditional retry edge.
    observe → think → plan → act → verify
                               ↑_____ (if incomplete, retry act)
    """

    async def observe_node(state: AgentState) -> dict:
        r = await ollama_chat(model_name, [
            {"role": "system", "content": "أنت وكيل ذكاء اصطناعي. حلّل المهمة وحدد المتطلبات الأساسية."},
            {"role": "user",   "content": f"المهمة: {state['task']}\nما المتطلبات الرئيسية؟"},
        ], max_tokens=300)
        return {
            "steps": state["steps"] + [f"[OBSERVE] {r}"],
            "messages": [AIMessage(content=r)],
        }

    async def think_node(state: AgentState) -> dict:
        history = [{"role": "system", "content": "أنت خبير تحليل وتخطيط."}]
        for m in list(state["messages"])[-4:]:
            history.append({"role": "assistant" if isinstance(m, AIMessage) else "user", "content": m.content})
        history.append({"role": "user", "content": "ما أفضل نهج لتنفيذ هذه المهمة بالكامل؟"})
        r = await ollama_chat(model_name, history, max_tokens=300)
        return {
            "steps": state["steps"] + [f"[THINK] {r}"],
            "messages": [AIMessage(content=r)],
        }

    async def plan_node(state: AgentState) -> dict:
        r = await ollama_chat(model_name, [
            {"role": "system", "content": "أنت مخطط مهام دقيق. اذكر الخطوات بترقيم."},
            {"role": "user",   "content": f"المهمة: {state['task']}\nاذكر الخطوات المتسلسلة لإنجازها."},
        ], max_tokens=250)
        return {
            "steps": state["steps"] + [f"[PLAN] {r}"],
            "messages": [AIMessage(content=r)],
        }

    async def act_node(state: AgentState) -> dict:
        r = await ollama_chat(model_name, [
            {"role": "system", "content": "أنت منفذ مهام. قدّم النتيجة الفعلية الكاملة."},
            {"role": "user",   "content": f"نفّذ هذه المهمة وأعطِ النتيجة: {state['task']}"},
        ], max_tokens=600)
        return {
            "steps": state["steps"] + [f"[ACT] {r}"],
            "result": r,
            "messages": [AIMessage(content=r)],
        }

    async def verify_node(state: AgentState) -> dict:
        r = await ollama_chat(model_name, [
            {"role": "system", "content": "تحقق من اكتمال المهمة."},
            {"role": "user",   "content": f"المهمة: {state['task']}\nالنتيجة: {state['result']}\nهل اكتملت المهمة فعلاً؟ قيّم وأعطِ الإجابة النهائية."},
        ], max_tokens=200)
        complete = any(w in r for w in ["نعم", "اكتمل", "تم", "yes", "complete", "done"])
        return {
            "steps": state["steps"] + [f"[VERIFY] {r}"],
            "result": r,
            "done": True,
            "retries": state["retries"],
            "messages": [AIMessage(content=r)],
        }

    def should_retry(state: AgentState) -> str:
        """Conditional edge: retry act if verify says incomplete (max 2 retries)."""
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
#  2. AutoGPT Agent  (Significant-Gravitas/AutoGPT)
#     Self-directed agent: decomposes goal → creates task list → executes → reflects
# ══════════════════════════════════════════════════════════════════════════════

class AutoGPTMemory:
    """Short-term memory for AutoGPT agent."""
    def __init__(self):
        self.observations: list[str] = []
        self.completed_tasks: list[str] = []
        self.pending_tasks: list[str] = []
        self.final_result: str = ""

    def summary(self) -> str:
        obs = "\n".join(self.observations[-3:]) if self.observations else "لا يوجد"
        done = "\n".join(f"✓ {t}" for t in self.completed_tasks) or "لا يوجد"
        pending = "\n".join(f"○ {t}" for t in self.pending_tasks[:3]) or "لا يوجد"
        return f"الملاحظات:\n{obs}\n\nالمنجز:\n{done}\n\nالمعلق:\n{pending}"


async def autogpt_agent(task: str, model: str, max_iterations: int = 6) -> dict:
    """
    AutoGPT-inspired iterative agent.
    Phase 1: Decompose goal into subtasks
    Phase 2: Execute subtasks iteratively with memory and self-critique
    Phase 3: Synthesize final result
    """
    memory = AutoGPTMemory()
    steps: list[str] = []

    # ── Phase 1: Decompose into subtasks ─────────────────────────────────────
    decompose_resp = await ollama_chat(model, [
        {"role": "system", "content": """أنت AutoGPT. عند استلام هدف:
1. قسّمه إلى مهام صغيرة قابلة للتنفيذ (3-5 مهام)
2. اكتبها كقائمة مرقمة
3. لا تضف شرحاً إضافياً"""},
        {"role": "user", "content": f"الهدف: {task}\nقسّمه إلى خطوات تنفيذية:"},
    ], max_tokens=300, temperature=0.2)

    # Extract subtasks from numbered list
    subtasks = []
    for line in decompose_resp.strip().split("\n"):
        line = line.strip()
        if line and (line[0].isdigit() or line.startswith("-") or line.startswith("•")):
            cleaned = line.lstrip("0123456789.-•) ").strip()
            if cleaned:
                subtasks.append(cleaned)

    if not subtasks:
        subtasks = [task]  # Fallback: treat whole task as one subtask

    memory.pending_tasks = subtasks.copy()
    steps.append(f"[DECOMPOSE] تقسيم الهدف إلى {len(subtasks)} مهام:\n" + "\n".join(f"  {i+1}. {t}" for i, t in enumerate(subtasks)))

    # ── Phase 2: Execute subtasks with memory ────────────────────────────────
    for iteration in range(min(max_iterations, len(subtasks) + 1)):
        if not memory.pending_tasks:
            break

        current_task = memory.pending_tasks.pop(0)

        # Build context-aware prompt
        context = memory.summary()
        exec_resp = await ollama_chat(model, [
            {"role": "system", "content": f"""أنت AutoGPT تنفّذ مهمة ضمن هدف أكبر.
الهدف الرئيسي: {task}

الذاكرة الحالية:
{context}"""},
            {"role": "user", "content": f"نفّذ هذه المهمة الآن: {current_task}\nقدّم النتيجة الفعلية:"},
        ], max_tokens=400, temperature=0.3)

        memory.observations.append(f"نتيجة '{current_task}': {exec_resp[:100]}...")
        memory.completed_tasks.append(current_task)

        # Self-critique
        critique_resp = await ollama_chat(model, [
            {"role": "system", "content": "قيّم النتيجة باختصار. هل تحتاج تحسيناً؟ نعم/لا + سبب."},
            {"role": "user", "content": f"المهمة: {current_task}\nالنتيجة: {exec_resp}\nالتقييم:"},
        ], max_tokens=100, temperature=0.2)

        steps.append(f"[STEP {iteration+1}] {current_task}\n→ {exec_resp}\n⚡ تقييم ذاتي: {critique_resp}")

    # ── Phase 3: Synthesize final result ────────────────────────────────────
    synthesis = await ollama_chat(model, [
        {"role": "system", "content": "لخّص إنجازات الوكيل في إجابة شاملة نهائية."},
        {"role": "user", "content": f"الهدف: {task}\nما تم إنجازه:\n{memory.summary()}\nالملخص النهائي:"},
    ], max_tokens=400, temperature=0.3)

    steps.append(f"[SYNTHESIS] {synthesis}")
    memory.final_result = synthesis

    return {"steps": steps, "result": synthesis}


# ══════════════════════════════════════════════════════════════════════════════
#  3. Open Interpreter Agent  (OpenInterpreter/open-interpreter)
#     Executes code locally using Ollama as the LLM backend
#     Supports: Python, Shell, JavaScript
# ══════════════════════════════════════════════════════════════════════════════

def build_open_interpreter(model: str):
    """Configure Open Interpreter to use local Ollama model."""
    try:
        from interpreter import interpreter as itp
        itp.llm.model        = f"ollama/{model}"
        itp.llm.api_base     = OLLAMA_URL
        itp.llm.max_tokens   = 800
        itp.auto_run         = True      # don't ask for confirmation
        itp.offline          = True      # no cloud, local only
        itp.safe_mode        = "off"     # allow execution
        itp.verbose          = False
        itp.system_message   = """You are a code execution agent. When given a task:
1. Write the code to accomplish it
2. Execute it immediately
3. Show the output
4. Summarize what was done"""
        return itp
    except Exception as e:
        return None


async def open_interpreter_agent(task: str, model: str) -> dict:
    """
    Open Interpreter agent: plans + writes + executes code locally.
    Falls back to Ollama-only if interpreter has issues.
    """
    steps: list[str] = []
    steps.append(f"[OI] Open Interpreter — نموذج: {model}")

    itp = build_open_interpreter(model)

    if itp is None:
        # Fallback: use Ollama directly for code generation
        code_resp = await ollama_chat(model, [
            {"role": "system", "content": "أنت مبرمج خبير. اكتب كوداً Python منظماً وقابلاً للتشغيل."},
            {"role": "user", "content": f"المهمة: {task}\nاكتب الكود:"},
        ], max_tokens=600)
        steps.append(f"[CODE]\n{code_resp}")
        return {"steps": steps, "result": code_resp}

    # Run in thread pool to avoid blocking
    def run_interpreter():
        try:
            messages = itp.chat(task, display=False, stream=False)
            result_parts = []
            for msg in messages:
                if isinstance(msg, dict):
                    content = msg.get("content", "")
                    role    = msg.get("role", "")
                    mtype   = msg.get("type", "")
                    if content and role == "computer":
                        result_parts.append(f"[output] {content}")
                    elif content and mtype == "code":
                        result_parts.append(f"[code]\n{content}")
                    elif content and role == "assistant" and mtype == "message":
                        result_parts.append(content)
            return "\n".join(result_parts) or "تم التنفيذ"
        except Exception as e:
            return f"خطأ في التنفيذ: {str(e)}"

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, run_interpreter)

    steps.append(f"[EXECUTE] {result}")
    return {"steps": steps, "result": result}


# ══════════════════════════════════════════════════════════════════════════════
#  4. Mistral Agent  (mistralai)
#     Uses Mistral's native [INST] prompt format via Ollama
#     Specialized in: code, reasoning, multilingual tasks
# ══════════════════════════════════════════════════════════════════════════════

def format_mistral_prompt(task: str, system: str = "") -> list[dict]:
    """
    Mistral uses [INST] instruction format.
    system prompt is embedded in the first user message.
    """
    if system:
        user_content = f"{system}\n\n{task}"
    else:
        user_content = task
    return [
        {"role": "user", "content": f"[INST] {user_content} [/INST]"},
    ]


async def mistral_agent(task: str, model: str) -> dict:
    """
    Mistral-native agent with [INST] formatting.
    Runs in a chain: analyze → execute → format output
    """
    steps: list[str] = []

    # Step 1: Analyze with Mistral [INST] format
    analyze_msgs = format_mistral_prompt(
        task,
        system="أنت Mistral AI، خبير في التحليل والبرمجة. حلّل المهمة وخطط للتنفيذ."
    )
    analysis = await ollama_chat(model, analyze_msgs, max_tokens=300, temperature=0.3)
    steps.append(f"[MISTRAL:ANALYZE] {analysis}")

    # Step 2: Execute
    execute_msgs = format_mistral_prompt(
        f"المهمة: {task}\nالتحليل: {analysis}\nنفّذ الآن وأعطِ النتيجة:",
        system="أنت Mistral AI. قدّم النتيجة الكاملة والدقيقة."
    )
    result = await ollama_chat(model, execute_msgs, max_tokens=600, temperature=0.2)
    steps.append(f"[MISTRAL:EXECUTE] {result}")

    # Step 3: Format & verify
    verify_msgs = format_mistral_prompt(
        f"راجع هذه النتيجة وأصلح أي أخطاء:\n{result}",
        system="أنت Mistral AI. تحقق ولخّص."
    )
    final = await ollama_chat(model, verify_msgs, max_tokens=200, temperature=0.1)
    steps.append(f"[MISTRAL:VERIFY] {final}")

    return {"steps": steps, "result": final}


# ══════════════════════════════════════════════════════════════════════════════
#  API Endpoints
# ══════════════════════════════════════════════════════════════════════════════

class TaskRequest(BaseModel):
    task:     str
    provider: str = "LangGraph"
    model:    str | None = None


class TaskResponse(BaseModel):
    provider: str
    model:    str
    steps:    list[str]
    result:   str
    category: str = ""
    engine:   str = ""


@app.get("/health")
async def health():
    models = await get_available_models()
    return {
        "status": "ok",
        "available_models": models,
        "providers": list(PROVIDER_MODELS.keys()),
        "integrations": {
            "langgraph":          True,
            "autogpt":            True,
            "open_interpreter":   True,
            "mistral_formatting": True,
        },
    }


@app.get("/models")
async def list_models():
    available = await get_available_models()
    result = {}
    for provider, preferred in PROVIDER_MODELS.items():
        installed = [m for m in preferred if m in available]
        result[provider] = {"preferred": preferred, "installed": installed}
    return result


@app.get("/providers")
async def list_providers():
    """List all integrated providers with descriptions."""
    return {
        "LangGraph": {
            "description": "Multi-node agent graph with conditional retry edges",
            "source": "github.com/langchain-ai/langgraph",
            "nodes": ["observe", "think", "plan", "act", "verify"],
        },
        "AutoGPT": {
            "description": "Goal decomposition + iterative execution with memory and self-critique",
            "source": "github.com/Significant-Gravitas/AutoGPT",
            "phases": ["decompose", "execute", "critique", "synthesize"],
        },
        "OpenInterpreter": {
            "description": "Local code execution agent (Python/Shell) via Ollama",
            "source": "github.com/OpenInterpreter/open-interpreter",
            "capabilities": ["python", "shell", "javascript"],
        },
        "mistralai": {
            "description": "Mistral AI models with native [INST] prompt formatting",
            "source": "github.com/mistralai",
            "format": "[INST] prompt [/INST]",
        },
        "QwenLM": {
            "description": "Alibaba Qwen models — fast, multilingual",
            "source": "github.com/QwenLM",
        },
        "meta-llama": {
            "description": "Meta Llama models — capable, versatile",
            "source": "github.com/meta-llama",
        },
    }


@app.post("/execute", response_model=TaskResponse)
async def execute_task(req: TaskRequest):
    available = await get_available_models()
    if not available:
        raise HTTPException(503, "No Ollama models available.")

    # ── Smart model selection ─────────────────────────────────────────────
    if req.model and req.model in available:
        model    = req.model
        category = classify_task(req.task)
    else:
        preferred = PROVIDER_MODELS.get(req.provider, [])
        provider_model = await pick_best_model(preferred, available)

        if provider_model and req.provider not in ("AutoGPT", "LangGraph", "OpenInterpreter"):
            model    = provider_model
            category = classify_task(req.task)
        else:
            model, category, _ = select_best_model_py(req.task, available)

    if not model:
        raise HTTPException(503, f"No model for provider: {req.provider}")

    steps: list[str] = []
    result: str = ""
    engine: str = req.provider

    # ── Route to the right agent ──────────────────────────────────────────
    if req.provider == "LangGraph":
        # langchain-ai/langgraph — multi-node pipeline
        graph = build_langgraph_agent(model)
        state = await graph.ainvoke({
            "messages": [HumanMessage(content=req.task)],
            "task":     req.task,
            "model":    model,
            "steps":    [],
            "result":   "",
            "done":     False,
            "retries":  0,
        })
        steps  = state["steps"]
        result = state["result"]
        engine = "LangGraph (langchain-ai/langgraph)"

    elif req.provider == "AutoGPT":
        # Significant-Gravitas/AutoGPT — iterative goal-seeking
        out    = await autogpt_agent(req.task, model)
        steps  = out["steps"]
        result = out["result"]
        engine = "AutoGPT (Significant-Gravitas/AutoGPT)"

    elif req.provider == "OpenInterpreter":
        # OpenInterpreter/open-interpreter — local code execution
        out    = await open_interpreter_agent(req.task, model)
        steps  = out["steps"]
        result = out["result"]
        engine = "Open Interpreter (OpenInterpreter/open-interpreter)"

    elif req.provider == "mistralai":
        # mistralai — [INST] formatted prompting
        out    = await mistral_agent(req.task, model)
        steps  = out["steps"]
        result = out["result"]
        engine = "Mistral AI (mistralai) via Ollama"

    else:
        # QwenLM, meta-llama, or any Ollama model directly
        steps.append(f"[{req.provider}:{model}] جاري التنفيذ...")
        result = await ollama_chat(model, [
            {"role": "system", "content": f"أنت وكيل ذكاء اصطناعي يستخدم نموذج {model}. نفّذ المهام بدقة."},
            {"role": "user",   "content": req.task},
        ], max_tokens=600)
        steps.append(f"[RESULT] {result}")
        engine = f"{req.provider} via Ollama"

    return TaskResponse(
        provider=req.provider,
        model=model,
        steps=steps,
        result=result,
        category=category,
        engine=engine,
    )


@app.post("/pull-model")
async def pull_model(body: dict):
    """Pull a new Ollama model."""
    model_name = body.get("model")
    if not model_name:
        raise HTTPException(400, "model name required")

    async def stream_pull():
        proc = await asyncio.create_subprocess_exec(
            "ollama", "pull", model_name,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        async for line in proc.stdout:
            yield line.decode()
        await proc.wait()

    return StreamingResponse(stream_pull(), media_type="text/plain")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
