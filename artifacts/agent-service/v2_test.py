import asyncio
import os
import sys

# إضافة المسار الحالي للسماح باستيراد الحزم
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from v2.core.agent import AgentLoop
from v2.core.model import ModelClient
from v2.browser.agent import BrowserAgent

async def main():
    print("🚀 بدء اختبار وكيل CortexFlow v2 المطور...")
    
    # تهيئة المكونات
    model_client = ModelClient(default_model="llama3.2:3b")
    browser = BrowserAgent(headless=True)
    agent = AgentLoop(model_client=model_client, browser_agent=browser)
    
    task = "اذهب إلى موقع google.com وابحث عن آخر أخبار الذكاء الاصطناعي، ثم أعطني ملخصاً لأول نتيجة."
    print(f"📝 المهمة: {task}")
    
    try:
        print("🌐 بدء تشغيل المتصفح (Playwright)...")
        await browser.start()
        
        print("🤖 بدء تشغيل حلقة الوكيل (Agent Loop)...")
        result = await agent.run(task)
        
        print("\n✅ النتيجة النهائية:")
        print(result)
        
        print("\n📊 تاريخ العمليات:")
        for h in agent.history:
            print(f"- [{h['iteration']}] {h['action']}: {h['thought'][:100]}...")
            
    except Exception as e:
        print(f"❌ فشل الاختبار: {str(e)}")
    finally:
        print("🛑 إغلاق المتصفح...")
        await browser.stop()

if __name__ == "__main__":
    asyncio.run(main())
