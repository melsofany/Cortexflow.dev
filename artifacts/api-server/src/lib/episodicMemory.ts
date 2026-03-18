/**
 * episodicMemory.ts — الذاكرة الإبستيمية الدائمة
 * ─────────────────────────────────────────────────────────────────────────────
 * مستوحى من أبحاث الذاكرة في AI Agents (2025):
 *   - Episodic Memory: أحداث ومحادثات سابقة مع طوابع زمنية
 *   - Semantic Memory: حقائق مستخلصة وقابلة للاسترجاع
 *   - Procedural Memory: أنماط النجاح والفشل المتعلَّمة
 *
 * التخزين: ملف JSON دائم (SQLite-lite بدون تبعيات خارجية)
 * الاسترجاع: بحث نصي بسيط مع تصنيف حسب الصلة والحداثة
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from "fs";
import path from "path";

export interface Episode {
  id: string;
  timestamp: string;
  sessionId: string;
  goal: string;
  category: string;
  summary: string;
  outcome: "success" | "failure" | "partial";
  keyFacts: string[];
  tools: string[];
  durationMs: number;
  score?: number;
}

export interface SemanticFact {
  id: string;
  topic: string;
  fact: string;
  confidence: number;
  source: string;
  timestamp: string;
  usageCount: number;
}

export interface ProceduralPattern {
  id: string;
  category: string;
  pattern: string;
  successRate: number;
  examples: string[];
  timestamp: string;
}

interface MemoryStore {
  episodes: Episode[];
  semanticFacts: SemanticFact[];
  proceduralPatterns: ProceduralPattern[];
  totalSessions: number;
  lastUpdated: string;
}

const MEMORY_FILE = path.join(process.cwd(), ".memory", "episodic_store.json");
const MAX_EPISODES = 200;
const MAX_FACTS = 500;

class EpisodicMemory {
  private store: MemoryStore;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.store = this.loadStore();
    this.scheduleAutoSave();
    console.log(`[EpisodicMemory] تم التحميل: ${this.store.episodes.length} حلقة، ${this.store.semanticFacts.length} حقيقة`);
  }

  private loadStore(): MemoryStore {
    try {
      const dir = path.dirname(MEMORY_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(MEMORY_FILE)) {
        const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn("[EpisodicMemory] خطأ في التحميل:", e);
    }
    return {
      episodes: [],
      semanticFacts: [],
      proceduralPatterns: [],
      totalSessions: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  private scheduleAutoSave() {
    setInterval(() => {
      if (this.dirty) this.saveStore();
    }, 30000);
  }

  private saveStore() {
    try {
      const dir = path.dirname(MEMORY_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.store.lastUpdated = new Date().toISOString();
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(this.store, null, 2), "utf-8");
      this.dirty = false;
    } catch (e) {
      console.warn("[EpisodicMemory] فشل الحفظ:", e);
    }
  }

  storeEpisode(episode: Omit<Episode, "id">): string {
    const id = `ep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newEp: Episode = { ...episode, id };
    this.store.episodes.unshift(newEp);

    if (this.store.episodes.length > MAX_EPISODES) {
      this.store.episodes = this.store.episodes.slice(0, MAX_EPISODES);
    }

    this.store.totalSessions++;
    this.dirty = true;
    setTimeout(() => this.saveStore(), 1000);
    return id;
  }

  storeSemanticFact(topic: string, fact: string, confidence: number, source: string): void {
    const existing = this.store.semanticFacts.find(
      f => f.topic === topic && this.similarity(f.fact, fact) > 0.8,
    );

    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      existing.usageCount++;
      existing.timestamp = new Date().toISOString();
    } else {
      const id = `sf_${Date.now()}`;
      this.store.semanticFacts.unshift({ id, topic, fact, confidence, source, timestamp: new Date().toISOString(), usageCount: 1 });
      if (this.store.semanticFacts.length > MAX_FACTS) {
        this.store.semanticFacts = this.store.semanticFacts.slice(0, MAX_FACTS);
      }
    }
    this.dirty = true;
  }

  storeProceduralPattern(category: string, pattern: string, success: boolean, example: string): void {
    const existing = this.store.proceduralPatterns.find(
      p => p.category === category && this.similarity(p.pattern, pattern) > 0.7,
    );

    if (existing) {
      const total = existing.examples.length + 1;
      const prevSuccesses = Math.round(existing.successRate * (total - 1));
      existing.successRate = (prevSuccesses + (success ? 1 : 0)) / total;
      existing.examples = [example, ...existing.examples].slice(0, 5);
      existing.timestamp = new Date().toISOString();
    } else {
      this.store.proceduralPatterns.push({
        id: `pp_${Date.now()}`,
        category,
        pattern,
        successRate: success ? 1 : 0,
        examples: [example],
        timestamp: new Date().toISOString(),
      });
    }
    this.dirty = true;
  }

  retrieveRelevantEpisodes(query: string, limit = 5): Episode[] {
    const queryWords = this.tokenize(query);
    const scored = this.store.episodes.map(ep => {
      const text = `${ep.goal} ${ep.summary} ${ep.keyFacts.join(" ")}`;
      const score = this.scoreRelevance(queryWords, text) + (ep.outcome === "success" ? 0.2 : 0);
      return { ep, score };
    });
    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.ep);
  }

  retrieveSemanticFacts(topic: string, limit = 10): SemanticFact[] {
    const queryWords = this.tokenize(topic);
    return this.store.semanticFacts
      .filter(f => this.scoreRelevance(queryWords, `${f.topic} ${f.fact}`) > 0)
      .sort((a, b) => b.confidence - a.confidence || b.usageCount - a.usageCount)
      .slice(0, limit);
  }

  getProceduralGuidance(category: string): string {
    const patterns = this.store.proceduralPatterns
      .filter(p => p.category === category && p.successRate > 0.6)
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, 3);

    if (patterns.length === 0) return "";
    return patterns.map(p => `• ${p.pattern} (نجاح: ${Math.round(p.successRate * 100)}%)`).join("\n");
  }

  buildContextualHint(query: string): string {
    const episodes = this.retrieveRelevantEpisodes(query, 3);
    const facts = this.retrieveSemanticFacts(query, 5);

    const parts: string[] = [];

    if (episodes.length > 0) {
      parts.push("**من الذاكرة الإبستيمية (محادثات سابقة ذات صلة):**");
      episodes.forEach(ep => {
        const icon = ep.outcome === "success" ? "✅" : ep.outcome === "partial" ? "⚠️" : "❌";
        parts.push(`${icon} ${ep.goal}: ${ep.summary}`);
        if (ep.keyFacts.length > 0) {
          parts.push(`  حقائق: ${ep.keyFacts.slice(0, 2).join(", ")}`);
        }
      });
    }

    if (facts.length > 0) {
      parts.push("\n**حقائق ذات صلة:**");
      facts.forEach(f => parts.push(`• ${f.fact}`));
    }

    return parts.join("\n");
  }

  getStats(): { episodes: number; facts: number; patterns: number; sessions: number } {
    return {
      episodes: this.store.episodes.length,
      facts: this.store.semanticFacts.length,
      patterns: this.store.proceduralPatterns.length,
      sessions: this.store.totalSessions,
    };
  }

  getRecentEpisodes(limit = 10): Episode[] {
    return this.store.episodes.slice(0, limit);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\u0600-\u06FFa-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  private scoreRelevance(queryWords: string[], text: string): number {
    const docWords = this.tokenize(text);
    const matches = queryWords.filter(w => docWords.some(d => d.includes(w) || w.includes(d)));
    return matches.length / Math.max(queryWords.length, 1);
  }

  private similarity(a: string, b: string): number {
    const wordsA = new Set(this.tokenize(a));
    const wordsB = new Set(this.tokenize(b));
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    return union === 0 ? 0 : intersection / union;
  }
}

export const episodicMemory = new EpisodicMemory();
