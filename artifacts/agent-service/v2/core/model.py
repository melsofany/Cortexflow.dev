import httpx
import os
import json
from typing import List, Dict, Any, Optional

class ModelClient:
    """
    عميل موحد للتعامل مع نماذج الذكاء الاصطناعي (Ollama, DeepSeek).
    """
    def __init__(self, default_model: str = "llama3.2:3b"):
        self.ollama_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
        self.deepseek_key = os.getenv("DEEPSEEK_API_KEY", "")
        self.deepseek_url = "https://api.deepseek.com/v1/chat/completions"
        self.default_model = default_model

    async def chat(self, prompt: str, system_prompt: str = "أنت وكيل ذكاء اصطناعي محترف يساعد في حل المهام المعقدة.") -> str:
        """
        إرسال طلب دردشة إلى النموذج المتاح.
        """
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ]
        
        # محاولة DeepSeek أولاً إذا توفر المفتاح
        if self.deepseek_key:
            try:
                async with httpx.AsyncClient() as client:
                    response = await client.post(
                        self.deepseek_url,
                        json={
                            "model": "deepseek-chat",
                            "messages": messages,
                            "temperature": 0.3
                        },
                        headers={"Authorization": f"Bearer {self.deepseek_key}"},
                        timeout=60
                    )
                    if response.status_code == 200:
                        return response.json()["choices"][0]["message"]["content"]
            except Exception as e:
                print(f"فشل استدعاء DeepSeek: {e}")

        # التراجع إلى Ollama
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.ollama_url}/api/chat",
                    json={
                        "model": self.default_model,
                        "messages": messages,
                        "stream": False,
                        "options": {"temperature": 0.3}
                    },
                    timeout=180
                )
                if response.status_code == 200:
                    return response.json().get("message", {}).get("content", "")
        except Exception as e:
            return f"خطأ في الاتصال بالنماذج: {str(e)}"

        return "لا يمكن الوصول إلى أي نموذج ذكاء اصطناعي حالياً."
