import asyncio
import json
import re
from typing import List, Dict, Any, Optional
from datetime import datetime

class AgentLoop:
    """
    حلقة الوكيل (Agent Loop) المتطورة لإدارة المهام المعقدة.
    تتبع نهج: التخطيط -> التنفيذ -> الملاحظة -> التعديل.
    """
    def __init__(self, model_client, browser_agent=None):
        self.model_client = model_client
        self.browser = browser_agent
        self.history = []
        self.plan = []
        self.max_iterations = 10
        self.current_iteration = 0

    async def run(self, task: str):
        """
        تشغيل الوكيل لحل المهمة بالكامل.
        """
        self.current_iteration = 0
        self.history = []
        
        # 1. تحليل المهمة ووضع خطة أولية
        self.plan = await self.create_plan(task)
        
        while self.current_iteration < self.max_iterations:
            self.current_iteration += 1
            
            # 2. تقييم الحالة الحالية واختيار الخطوة القادمة
            state_summary = self.get_state_summary()
            
            # 3. اتخاذ قرار (تفكير واختيار أداة)
            decision = await self.decide(task, state_summary)
            
            # 4. تنفيذ العمل
            if decision.get("action") == "final_answer":
                return decision.get("answer")
            
            action_result = await self.execute_action(decision)
            
            # 5. تسجيل الملاحظة وتحديث الخطة إذا لزم الأمر
            self.history.append({
                "iteration": self.current_iteration,
                "thought": decision.get("thought"),
                "action": decision.get("action"),
                "params": decision.get("params"),
                "observation": action_result
            })
            
            # تحديث الخطة بناءً على الملاحظات
            if self.should_update_plan(action_result):
                self.plan = await self.update_plan(task, self.history)

        return "وصلت إلى الحد الأقصى من التكرارات دون حل المهمة بالكامل."

    async def create_plan(self, task: str) -> List[str]:
        prompt = f"""أنت وكيل ذكاء اصطناعي محترف. حلل المهمة التالية وضع خطة عمل مرقمة ومفصلة:
المهمة: {task}
اكتب الخطة كقائمة مرقمة بسيطة وواضحة."""
        response = await self.model_client.chat(prompt)
        return response.strip().split("\n")

    async def decide(self, task: str, state: str) -> Dict[str, Any]:
        prompt = f"""الهدف الرئيسي: {task}
الحالة الراهنة والخطة:
{state}

بناءً على الحالة الحالية، ما هي خطوتك القادمة؟
يجب أن يكون ردك بتنسيق JSON حصراً كالتالي:
{{
  "thought": "تفكيرك العميق في الخطوة القادمة بناءً على الملاحظات السابقة",
  "action": "اسم الأداة (navigate, click, type, search, final_answer)",
  "params": {{"key": "value"}},
  "plan_status": "ما تم إنجازه من الخطة"
}}"""
        response = await self.model_client.chat(prompt)
        try:
            # استخراج JSON من الرد
            json_match = re.search(r'\{.*\}', response, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(0))
            return {"thought": "خطأ في التنسيق", "action": "final_answer", "params": {"answer": response}}
        except:
            return {"thought": "فشل التحليل", "action": "final_answer", "params": {"answer": response}}

    async def execute_action(self, decision: Dict[str, Any]) -> str:
        action = decision.get("action")
        params = decision.get("params", {})
        
        if action == "navigate":
            return await self.browser.navigate(params.get("url"))
        elif action == "click":
            return await self.browser.click(params.get("selector"))
        elif action == "type":
            return await self.browser.type_text(params.get("selector"), params.get("text"))
        elif action == "get_content":
            return await self.browser.get_content()
        elif action == "screenshot":
            return await self.browser.screenshot()
        else:
            return f"الأداة {action} غير معروفة حالياً."

    def get_state_summary(self) -> str:
        summary = "الخطة:\n" + "\n".join(self.plan) + "\n\n"
        summary += "تاريخ العمليات:\n"
        for h in self.history[-3:]: # آخر 3 عمليات فقط لتوفير السياق
            summary += f"- فكرت: {h['thought']}\n"
            summary += f"- فعلت: {h['action']} ({h['params']})\n"
            summary += f"- لاحظت: {str(h['observation'])[:200]}...\n"
        return summary

    def should_update_plan(self, observation: str) -> bool:
        # إذا فشلت العملية أو كانت النتيجة غير متوقعة
        if "خطأ" in observation or "فشل" in observation:
            return True
        return False

    async def update_plan(self, task: str, history: List[Dict]) -> List[str]:
        prompt = f"""المهمة الأصلية: {task}
التاريخ: {json.dumps(history[-2:], ensure_ascii=False)}
الخطة الحالية: {self.plan}

حدثت تطورات، يرجى تحديث الخطة لتكون أكثر دقة وفعالية."""
        response = await self.model_client.chat(prompt)
        return response.strip().split("\n")
