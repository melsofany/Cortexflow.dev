# CortexFlow AI Agent Platform

## Overview

CortexFlow is a professional multi-agent AI platform. It uses a Planner Agent to decompose user goals into structured task plans, then routes each step to the appropriate specialized agent (Browser, Coder, Researcher, Reviewer, General). It includes a short-term + long-term memory system, real-time plan visualization, and hybrid AI routing (Ollama local → DeepSeek cloud).

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5 + Socket.io
- **Frontend**: React + Vite + Tailwind CSS + Framer Motion
- **AI Runtime**: Ollama (local CPU inference) → Python FastAPI agent service
- **Agent Loops**: OODA (primary), LangGraph, AutoGPT, Code Interpreter, Mistral
- **Agent Tools**: execute_code, calculate, read_file, write_file, web_search (DuckDuckGo), run_shell

## Architecture

```text
User (Frontend App.tsx)
  ↓  socket.io /api/socket
API Server (Express, port 8080)   ← io.emit() broadcasts to ALL clients
  ↓  agentRunner.ts → classifies task
  ├── Browser tasks → Playwright/Chromium browser agent
  ├── Math tasks → Python Agent Service (port 8090)
  └── Code/Research/Creative/General → Multi-Agent System:
        ↓
      PlannerAgent → TaskPlan (steps + agents)
        ↓
      MultiAgentOrchestrator → executes each step:
        ├── PlannerAgent (goal decomposition)
        ├── BrowserAgent (web navigation)
        ├── CoderAgent (programming tasks)
        ├── ResearcherAgent (information gathering)
        ├── ReviewerAgent (quality review)
        └── GeneralAgent (miscellaneous)
        ↓
      MemorySystem → short-term (session) + long-term (persistent)
        ↓
      Ollama (port 11434) → llama3.2:1b / qwen2:0.5b / llama3.2:3b
```

## Structure

```text
artifacts/
├── agent-service/          # Python FastAPI — OODA/LangGraph/AutoGPT/tools
│   └── main.py
├── api-server/             # Express 5 + Socket.io backend
│   └── src/
│       ├── lib/            # ollamaClient, taskStore, agentRunner, modelSelector
│       └── routes/         # health, tasks, ai, providers, logs
└── cortexflow/             # React + Vite frontend
    └── src/
        ├── components/     # chat-interface, thinking-steps, browser-view, task-sidebar
        └── App.tsx         # Main app with auto task classification
lib/
├── api-spec/               # OpenAPI spec + Orval codegen config
├── api-client-react/       # Generated React Query hooks
└── api-zod/                # Generated Zod schemas
```

## Key Features

- **Auto task classification**: browser / system / research / ai — no manual selection needed
- **OODA Loop**: Observe → Orient → Decide → Act loop with tool calls
- **Self-improvement**: PerformanceMemory records success/failure/quality per model per category
- **Smart model routing**: SelfImprovingModelSelector with 9 task categories and dynamic learned scores
- **Agent tools**: execute_code, calculate, read_file, write_file, web_search, run_shell
- **Real-time updates**: Socket.io streaming with thinking steps display
- **Arabic + English UI** support

## Services & Ports

| Service            | Port  | Notes                           |
|--------------------|-------|---------------------------------|
| Ollama             | 11434 | Local LLM inference (CPU)       |
| Python Agent       | 8090  | FastAPI OODA/LangGraph/AutoGPT  |
| API Server         | 8080  | Express + Socket.io             |
| CortexFlow UI      | 18188 | React + Vite                    |

## AI Models (Ollama)

| Model          | Size  | Best For                    |
|----------------|-------|-----------------------------|
| qwen2:0.5b     | 352MB | Quick tasks, chat, math     |
| llama3.2:1b    | 1.3GB | General reasoning, research |
| llama3.2:3b    | 2.0GB | Complex reasoning (DL)      |

## Self-Improvement Endpoints

- `GET /self-improvement` — view performance stats per model per category
- `POST /self-improvement/reset` — reset learned scores
- `GET /self-improvement/report` — generate improvement suggestions

## Known Performance Notes

- All inference runs on CPU (no GPU) — each LLM call takes 15-60s depending on model size
- Multi-agent plan: 1 planning call + N step calls + 1 review call (typically 5-8 total LLM calls)
- Model auto-selection prefers smaller models for speed unless performance data shows better results

## Bug Fixes Applied

- **Socket broadcast fix**: Changed `socket.emit()` → `io.emit()` for task events so results reach ALL connected clients, not just the original socket (fixes results lost on reconnect)
- **Reconnect delivery**: Added `lastCompletedTask` cache to re-deliver results to newly connected clients
- **Task routing**: Code/agent/reasoning tasks now use multi-agent system instead of Python agent (only math still uses Python agent for precise calculation)
- **Tab switching**: Browser tasks auto-switch to browser tab on mobile; task completion switches back to chat tab
