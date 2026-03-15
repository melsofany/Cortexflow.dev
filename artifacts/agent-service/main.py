"""
CortexFlow Agent Service — Python Backend
Uses LangGraph (langchain-ai/langgraph) + Ollama local models
Supports: Meta Llama, Mistral, QwenLM, and more
"""

import os
import json
import asyncio
import subprocess
import httpx
from typing import TypedDict, Annotated, Sequence
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import uvicorn

# LangGraph & LangChain
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langchain_core.language_models import BaseChatModel
from langchain_core.outputs import ChatResult, ChatGeneration
from langchain_core.messages import AIMessageChunk
import langgraph
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
PORT = int(os.getenv("AGENT_SERVICE_PORT", "8090"))

app = FastAPI(title="CortexFlow Agent Service")

# ── Available Models Registry ─────────────────────────────────────────────────
PROVIDER_MODELS = {
    "QwenLM":     ["qwen2:0.5b", "qwen2.5:0.5b", "qwen2:1.5b"],
    "meta-llama": ["llama3.2:1b", "llama3.2:3b", "llama3:8b"],
    "mistralai":  ["mistral:7b-instruct-q2_K", "mistral:latest", "mistral:7b"],
    "AutoGPT":    ["qwen2:0.5b", "llama3.2:1b"],   # AutoGPT uses best available
    "LangGraph":  ["qwen2:0.5b", "llama3.2:1b"],   # LangGraph orchestration
}


async def get_available_models() -> list[str]:
    """Fetch locally installed Ollama models."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags", timeout=5)
            return [m["name"] for m in resp.json().get("models", [])]
    except Exception:
        return []


async def pick_best_model(preferred: list[str], available: list[str]) -> str | None:
    for m in preferred:
        if m in available:
            return m
    return available[0] if available else None


# ── Smart Model Selection ─────────────────────────────────────────────────────

TASK_KEYWORDS = {
    "browser":     ["افتح", "تصفح", "انتقل", "موقع", "سجل", "حساب", "facebook", "twitter",
                    "فيسبوك", "تويتر", "انستجرام", "يوتيوب", "web", "url", "اشتر", "احجز"],
    "code":        ["اكتب كود", "برمجة", "كود", "script", "python", "javascript", "برنامج",
                    "function", "api", "class", "اكتب برنامج", "debug", "typescript", "sql"],
    "research":    ["ابحث", "اشرح", "ما هو", "ما هي", "كيف", "لماذا", "معلومات", "تحليل",
                    "قارن", "مقارنة", "دراسة", "تقرير", "ملخص", "explain", "research"],
    "creative":    ["اكتب", "قصة", "مقال", "قصيدة", "محتوى", "نص", "وصف", "إعلان",
                    "write", "story", "article", "blog", "منشور"],
    "math":        ["احسب", "حساب", "معادلة", "رياضيات", "calculate", "math", "equation",
                    "formula", "percentage", "نسبة مئوية"],
    "translation": ["ترجم", "translation", "translate", "بالعربية", "بالإنجليزية", "اللغة"],
    "reasoning":   ["فكّر", "استنتج", "هل يمكن", "ما الأفضل", "قيّم", "تقييم", "قرار",
                    "توصية", "نصيحة", "scenario", "تحليل عميق"],
    "simple":      [],
}

# Model capability scores per task type (higher = better)
MODEL_SCORES: dict[str, dict[str, int]] = {
    "qwen2:0.5b":               {"browser": 3, "code": 1, "research": 1, "creative": 1, "math": 1, "translation": 3, "reasoning": 1, "simple": 3},
    "qwen2.5:0.5b":             {"browser": 3, "code": 2, "research": 1, "creative": 1, "math": 1, "translation": 3, "reasoning": 1, "simple": 3},
    "llama3.2:1b":              {"browser": 2, "code": 3, "research": 3, "creative": 3, "math": 2, "translation": 2, "reasoning": 3, "simple": 2},
    "llama3.2:3b":              {"browser": 2, "code": 3, "research": 3, "creative": 3, "math": 3, "translation": 2, "reasoning": 3, "simple": 2},
    "mistral:7b-instruct-q2_K": {"browser": 1, "code": 3, "research": 3, "creative": 3, "math": 3, "translation": 3, "reasoning": 3, "simple": 1},
    "mistral:latest":           {"browser": 1, "code": 3, "research": 3, "creative": 3, "math": 3, "translation": 3, "reasoning": 3, "simple": 1},
}


def classify_task(description: str, task_type: str = "") -> str:
    if task_type == "browser":
        return "browser"
    text = description.lower()
    scores = {cat: 0 for cat in TASK_KEYWORDS}
    for cat, keywords in TASK_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in text:
                scores[cat] += 1
    if len(description.split()) <= 5:
        scores["simple"] += 2
    best = max(scores.items(), key=lambda x: x[1])
    return best[0] if best[1] > 0 else "simple"


def select_best_model_py(description: str, available: list[str], task_type: str = "") -> tuple[str, str, str]:
    """Returns (model_name, category, reason)"""
    category = classify_task(description, task_type)
    if not available:
        return ("qwen2:0.5b", category, "لا يوجد نماذج — استخدام الافتراضي")

    best_model = available[0]
    best_score = -1
    for m in available:
        score = MODEL_SCORES.get(m, {}).get(category, 1)
        if score > best_score:
            best_score = score
            best_model = m

    reasons = {
        "browser":     "مهمة تصفح ويب — نموذج سريع للتنقل",
        "code":        "مهمة برمجية — نموذج متخصص في الكود",
        "research":    "مهمة بحثية — نموذج ذو قدرة تحليلية عالية",
        "creative":    "مهمة إبداعية — نموذج ذو قدرة توليدية",
        "math":        "مهمة رياضية — نموذج ذو منطق دقيق",
        "translation": "مهمة ترجمة — نموذج متعدد اللغات",
        "reasoning":   "مهمة تفكير معقدة — أقوى نموذج متاح",
        "simple":      "مهمة بسيطة — نموذج سريع وكافٍ",
    }
    return (best_model, category, reasons.get(category, ""))


async def ollama_chat(model: str, messages: list[dict], max_tokens: int = 500) -> str:
    """Call Ollama chat API."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": model,
                "messages": messages,
                "stream": False,
                "options": {"num_predict": max_tokens, "temperature": 0.3},
            },
            timeout=120,
        )
        return resp.json().get("message", {}).get("content", "")


# ── LangGraph Agent State ─────────────────────────────────────────────────────

class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    task: str
    model: str
    steps: list[str]
    result: str
    done: bool


def build_agent_graph(model_name: str):
    """Build a LangGraph multi-step agent graph."""

    async def observe_node(state: AgentState) -> AgentState:
        msgs = [
            {"role": "system", "content": "أنت وكيل ذكاء اصطناعي. حلل المهمة وحدد المتطلبات."},
            {"role": "user", "content": f"المهمة: {state['task']}\nما المتطلبات الرئيسية؟"},
        ]
        response = await ollama_chat(model_name, msgs, max_tokens=300)
        state["steps"].append(f"[OBSERVE] {response}")
        state["messages"] = list(state["messages"]) + [AIMessage(content=response)]
        return state

    async def think_node(state: AgentState) -> AgentState:
        history = [{"role": "system", "content": "أنت وكيل ذكاء اصطناعي خبير."}]
        for msg in state["messages"][-4:]:
            role = "assistant" if isinstance(msg, AIMessage) else "user"
            history.append({"role": role, "content": msg.content})
        history.append({"role": "user", "content": "ما أفضل طريقة لتنفيذ هذه المهمة؟"})
        response = await ollama_chat(model_name, history, max_tokens=300)
        state["steps"].append(f"[THINK] {response}")
        state["messages"] = list(state["messages"]) + [AIMessage(content=response)]
        return state

    async def plan_node(state: AgentState) -> AgentState:
        msgs = [
            {"role": "system", "content": "أنت مخطط مهام. اذكر الخطوات بإيجاز."},
            {"role": "user", "content": f"المهمة: {state['task']}\nاذكر الخطوات المتسلسلة."},
        ]
        response = await ollama_chat(model_name, msgs, max_tokens=250)
        state["steps"].append(f"[PLAN] {response}")
        state["messages"] = list(state["messages"]) + [AIMessage(content=response)]
        return state

    async def act_node(state: AgentState) -> AgentState:
        msgs = [
            {"role": "system", "content": "أنت منفذ مهام. نفّذ وقدّم النتيجة الفعلية."},
            {"role": "user", "content": f"نفّذ هذه المهمة: {state['task']}"},
        ]
        response = await ollama_chat(model_name, msgs, max_tokens=500)
        state["steps"].append(f"[ACT] {response}")
        state["result"] = response
        state["messages"] = list(state["messages"]) + [AIMessage(content=response)]
        return state

    async def verify_node(state: AgentState) -> AgentState:
        msgs = [
            {"role": "system", "content": "تحقق من اكتمال المهمة ولخّص النتيجة."},
            {"role": "user", "content": f"المهمة: {state['task']}\nالنتيجة: {state['result']}\nهل اكتملت؟"},
        ]
        response = await ollama_chat(model_name, msgs, max_tokens=200)
        state["steps"].append(f"[VERIFY] {response}")
        state["done"] = True
        state["result"] = response
        return state

    # Build the graph
    graph = StateGraph(AgentState)
    graph.add_node("observe", observe_node)
    graph.add_node("think", think_node)
    graph.add_node("plan", plan_node)
    graph.add_node("act", act_node)
    graph.add_node("verify", verify_node)

    graph.set_entry_point("observe")
    graph.add_edge("observe", "think")
    graph.add_edge("think", "plan")
    graph.add_edge("plan", "act")
    graph.add_edge("act", "verify")
    graph.add_edge("verify", END)

    return graph.compile()


# ── AutoGPT-style Agent (iterative goal-seeking) ──────────────────────────────

async def autogpt_style_agent(task: str, model: str, max_iterations: int = 5) -> dict:
    """AutoGPT-inspired iterative agent using local models."""
    SYSTEM = """أنت وكيل ذاتي التشغيل (AutoGPT). لديك هدف تريد تحقيقه.
في كل خطوة اكتب بهذا الشكل:
THOUGHT: تفكيرك
ACTION: ما ستفعله
RESULT: النتيجة المتوقعة
DONE: نعم أو لا"""

    history = [{"role": "system", "content": SYSTEM}]
    steps = []

    for i in range(max_iterations):
        history.append({
            "role": "user",
            "content": f"الهدف: {task}\nالخطوة {i+1}: ماذا ستفعل الآن؟"
        })
        response = await ollama_chat(model, history, max_tokens=300)
        history.append({"role": "assistant", "content": response})
        steps.append(f"خطوة {i+1}: {response}")

        # Check if done
        if "DONE: نعم" in response or "done: yes" in response.lower() or i == max_iterations - 1:
            break

    return {"steps": steps, "result": steps[-1] if steps else ""}


# ── API Endpoints ──────────────────────────────────────────────────────────────

class TaskRequest(BaseModel):
    task: str
    provider: str = "QwenLM"       # QwenLM, meta-llama, mistralai, AutoGPT, LangGraph
    model: str | None = None       # Override model


class TaskResponse(BaseModel):
    provider: str
    model: str
    steps: list[str]
    result: str


@app.get("/health")
async def health():
    models = await get_available_models()
    return {
        "status": "ok",
        "available_models": models,
        "providers": list(PROVIDER_MODELS.keys()),
    }


@app.get("/models")
async def list_models():
    available = await get_available_models()
    result = {}
    for provider, preferred in PROVIDER_MODELS.items():
        installed = [m for m in preferred if m in available]
        result[provider] = {"preferred": preferred, "installed": installed}
    return result


@app.post("/execute", response_model=TaskResponse)
async def execute_task(req: TaskRequest):
    available = await get_available_models()
    if not available:
        raise HTTPException(503, "No Ollama models available. Make sure Ollama is running.")

    # Smart model selection: use specified model, or auto-select based on task
    if req.model and req.model in available:
        model = req.model
        category = classify_task(req.task)
        reason = "نموذج محدد يدوياً"
    else:
        model, category, reason = select_best_model_py(req.task, available)

    # If provider specifies preferred models, check if any are installed
    preferred = PROVIDER_MODELS.get(req.provider, [])
    if preferred:
        provider_model = await pick_best_model(preferred, available)
        if provider_model and req.provider not in ("AutoGPT", "LangGraph"):
            # For specific providers (not orchestrators), use their model
            model = provider_model

    if not model:
        raise HTTPException(503, f"No model available for provider: {req.provider}")

    steps = []
    result = ""

    if req.provider == "AutoGPT":
        # AutoGPT-style iterative agent
        agent_result = await autogpt_style_agent(req.task, model)
        steps = agent_result["steps"]
        result = agent_result["result"]

    elif req.provider == "LangGraph":
        # LangGraph multi-node pipeline
        graph = build_agent_graph(model)
        initial_state: AgentState = {
            "messages": [HumanMessage(content=req.task)],
            "task": req.task,
            "model": model,
            "steps": [],
            "result": "",
            "done": False,
        }
        final_state = await graph.ainvoke(initial_state)
        steps = final_state["steps"]
        result = final_state["result"]

    else:
        # Standard Ollama chat (QwenLM, meta-llama, mistralai)
        msgs = [
            {"role": "system", "content": f"أنت وكيل ذكاء اصطناعي يستخدم نموذج {model}. نفّذ المهام بدقة."},
            {"role": "user", "content": req.task},
        ]
        steps.append(f"[{req.provider}:{model}] جاري التنفيذ...")
        result = await ollama_chat(model, msgs, max_tokens=600)
        steps.append(f"[RESULT] {result}")

    return TaskResponse(provider=req.provider, model=model, steps=steps, result=result)


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
