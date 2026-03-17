import asyncio
import os
from typing import Optional, Dict, Any, List
from playwright.async_api import async_playwright, Page, Browser, BrowserContext

class BrowserAgent:
    """
    وكيل تصفح متطور يعتمد على Playwright.
    يوفر قدرات تفاعلية متقدمة مثل الانتظار الذكي، التقاط الصور، والتفاعل مع العناصر.
    """
    def __init__(self, headless: bool = True):
        self.headless = headless
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.playwright = None

    async def start(self):
        if not self.playwright:
            self.playwright = await async_playwright().start()
            self.browser = await self.playwright.chromium.launch(headless=self.headless)
            self.context = await self.browser.new_context(
                viewport={'width': 1280, 'height': 720},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
            )
            self.page = await self.context.new_page()

    async def stop(self):
        if self.browser:
            await self.browser.close()
        if self.playwright:
            await self.playwright.stop()

    async def navigate(self, url: str):
        if not self.page: await self.start()
        await self.page.goto(url, wait_until="networkidle")
        return f"تم الانتقال إلى {url}"

    async def click(self, selector: str):
        if not self.page: return "المتصفح غير مفعل"
        await self.page.click(selector)
        await self.page.wait_for_load_state("networkidle")
        return f"تم النقر على {selector}"

    async def type_text(self, selector: str, text: str):
        if not self.page: return "المتصفح غير مفعل"
        await self.page.fill(selector, text)
        return f"تمت كتابة النص في {selector}"

    async def get_content(self) -> str:
        if not self.page: return "المتصفh غير مفعل"
        # استخراج النص بشكل نظيف
        content = await self.page.evaluate("() => document.body.innerText")
        return content[:5000] # تحديد الحجم للسياق

    async def screenshot(self, path: str = "screenshot.png"):
        if not self.page: return "المتصفح غير مفعل"
        await self.page.screenshot(path=path)
        return f"تم حفظ لقطة الشاشة في {path}"

    async def get_interactive_elements(self) -> List[Dict[str, Any]]:
        """
        تحليل الصفحة لاستخراج العناصر التفاعلية (أزرار، روابط، حقول).
        """
        if not self.page: return []
        elements = await self.page.evaluate("""
            () => {
                const interactives = [];
                const sel = 'button, a, input, select, textarea, [role="button"]';
                document.querySelectorAll(sel).forEach((el, index) => {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        interactives.push({
                            index: index,
                            tagName: el.tagName,
                            text: el.innerText || el.value || el.placeholder || el.ariaLabel || "",
                            id: el.id,
                            className: el.className,
                            isVisible: true
                        });
                    }
                });
                return interactives.slice(0, 50); // أول 50 عنصر فقط لتوفير السياق
            }
        """)
        return elements
