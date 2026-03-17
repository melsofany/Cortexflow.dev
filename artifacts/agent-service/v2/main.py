import asyncio
import os
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from v2.core.agent import AgentLoop
from v2.core.model import ModelClient
from v2.browser.agent import BrowserAgent

app = FastAPI(title="CortexFlow Agent Service v2 — Enhanced Agentic System")

class TaskRequest(BaseModel):
    task: str
    model: Optional[str] = "llama3.2:3b"
    category: Optional[str] = "general"

@app.post("/v2/execute")
async def execute_task(request: TaskRequest):
    """
    تنفيذ مهمة باستخدام حلقة الوكيل v2.
    """
    model_client = ModelClient(default_model=request.model)
    browser = BrowserAgent(headless=True)
    agent = AgentLoop(model_client=model_client, browser_agent=browser)
    
    try:
        await browser.start()
        result = await agent.run(request.task)
        return {
            "status": "success",
            "task": request.task,
            "result": result,
            "history": agent.history
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل تنفيذ المهمة: {str(e)}")
    finally:
        await browser.stop()

@app.get("/v2/health")
async def health_check():
    return {"status": "ok", "version": "2.0.0"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8091)
