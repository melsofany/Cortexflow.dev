/**
 * verificationAgent.ts — وكيل التحقق من الجودة
 * ─────────────────────────────────────────────────────────────────────────────
 * مستوحى من Manus AI (ورقة ArXiv 2505.02024):
 *   Manus = Planner → Executor → **Verifier**
 *
 * الوكيل يقيّم جودة الناتج 1-10 ويُحدد:
 *   - العناصر الناقصة
 *   - الأخطاء أو التناقضات
 *   - هل يجب إعادة التخطيط؟
 *   - توصيات للتحسين
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface VerificationResult {
  score: number;
  passed: boolean;
  missingElements: string[];
  errors: string[];
  suggestions: string[];
  rePlanNeeded: boolean;
  rePlanReason?: string;
  summary: string;
}

export interface VerificationInput {
  goal: string;
  plan: Array<{ title: string; description: string }>;
  results: Record<string, string>;
  finalAnswer: string;
  category?: string;
}

type LLMFn = (messages: Array<{ role: string; content: string }>, maxTokens?: number) => Promise<string>;

class VerificationAgent {
  private threshold = 6.5;

  async verify(
    input: VerificationInput,
    callLLM: LLMFn,
  ): Promise<VerificationResult> {
    const { goal, plan, results, finalAnswer, category } = input;

    const planSummary = plan
      .map((s, i) => `${i + 1}. ${s.title}: ${s.description}`)
      .join("\n");

    const resultsSummary = Object.entries(results)
      .map(([k, v]) => `[${k}]: ${(v || "").substring(0, 300)}`)
      .join("\n");

    const prompt = `أنت وكيل التحقق في نظام CortexFlow متعدد الوكلاء.

**الهدف الأصلي:** ${goal}

**الخطة المُنفَّذة:**
${planSummary}

**النتائج الجزئية:**
${resultsSummary.substring(0, 1500)}

**الإجابة النهائية:**
${finalAnswer.substring(0, 1500)}

**مهمتك:** قيّم جودة الإجابة النهائية بالنسبة للهدف الأصلي.

أجب بـ JSON فقط بهذا الشكل (بلا أي نص خارج JSON):
{
  "score": <رقم من 1 إلى 10>,
  "passed": <true/false إذا كان الناتج يحقق الهدف>,
  "missingElements": ["عنصر ناقص 1", "عنصر ناقص 2"],
  "errors": ["خطأ 1", "خطأ 2"],
  "suggestions": ["توصية 1", "توصية 2"],
  "rePlanNeeded": <true إذا كانت إعادة التخطيط ضرورية>,
  "rePlanReason": "<سبب إعادة التخطيط إن وجد>",
  "summary": "<ملخص قصير للتقييم بالعربية>"
}`;

    try {
      const raw = await callLLM(
        [
          { role: "system", content: "أنت وكيل تحقق متخصص. أجب بـ JSON فقط." },
          { role: "user", content: prompt },
        ],
        600,
      );

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const score = Number(parsed.score) || 5;
        return {
          score,
          passed: parsed.passed ?? score >= this.threshold,
          missingElements: Array.isArray(parsed.missingElements) ? parsed.missingElements : [],
          errors: Array.isArray(parsed.errors) ? parsed.errors : [],
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
          rePlanNeeded: parsed.rePlanNeeded ?? false,
          rePlanReason: parsed.rePlanReason || undefined,
          summary: parsed.summary || "تم التحقق من الناتج",
        };
      }
    } catch (e) {
      console.warn("[VerificationAgent] فشل تحليل JSON:", e);
    }

    return this.fallbackVerification(finalAnswer, goal);
  }

  async selfReflect(
    output: string,
    goal: string,
    callLLM: LLMFn,
  ): Promise<{ score: number; needsRetry: boolean; improvement: string }> {
    const prompt = `قيّم الناتج التالي بالنسبة للهدف.

**الهدف:** ${goal}
**الناتج:** ${output.substring(0, 1000)}

أجب بـ JSON فقط:
{
  "score": <1-10>,
  "needsRetry": <true/false>,
  "improvement": "<ما يجب تحسينه>"
}`;

    try {
      const raw = await callLLM(
        [{ role: "user", content: prompt }],
        300,
      );
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const p = JSON.parse(m[0]);
        return {
          score: Number(p.score) || 5,
          needsRetry: p.needsRetry ?? false,
          improvement: p.improvement || "",
        };
      }
    } catch { /* ignore */ }

    return { score: 7, needsRetry: false, improvement: "" };
  }

  private fallbackVerification(answer: string, goal: string): VerificationResult {
    const wordCount = answer.trim().split(/\s+/).length;
    const score = wordCount > 100 ? 7 : wordCount > 30 ? 5 : 3;
    return {
      score,
      passed: score >= this.threshold,
      missingElements: score < this.threshold ? ["إجابة أكثر تفصيلاً"] : [],
      errors: [],
      suggestions: [],
      rePlanNeeded: score < 4,
      summary: score >= this.threshold ? "الناتج مقبول" : "الناتج يحتاج تحسيناً",
    };
  }

  formatReport(result: VerificationResult): string {
    const icon = result.passed ? "✅" : result.rePlanNeeded ? "🔄" : "⚠️";
    const lines = [
      `${icon} **تقرير التحقق** — الدرجة: ${result.score}/10`,
      result.summary,
    ];

    if (result.missingElements.length > 0) {
      lines.push(`\n**عناصر ناقصة:**\n${result.missingElements.map(e => `- ${e}`).join("\n")}`);
    }
    if (result.errors.length > 0) {
      lines.push(`\n**أخطاء:**\n${result.errors.map(e => `- ${e}`).join("\n")}`);
    }
    if (result.suggestions.length > 0) {
      lines.push(`\n**توصيات:**\n${result.suggestions.map(s => `- ${s}`).join("\n")}`);
    }
    if (result.rePlanNeeded) {
      lines.push(`\n🔄 **إعادة التخطيط مطلوبة:** ${result.rePlanReason || "الناتج لا يحقق الهدف"}`);
    }

    return lines.join("\n");
  }
}

export const verificationAgent = new VerificationAgent();
