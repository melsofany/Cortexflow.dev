# CortexFlow AI Agent Platform

## Overview

CortexFlow is a full-featured AI agent browser platform with a dark cyberpunk UI. It supports local Ollama models (Llama, Mistral, Qwen, DeepSeek-r1, etc.) and falls back to simulation mode when Ollama is not running.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5 + Socket.io
- **Database**: In-memory (TaskStore) — no external DB needed
- **Frontend**: React + Vite + Tailwind CSS + Framer Motion
- **AI**: Ollama (local), DeepSeek (cloud), Mistral, Qwen — via IntegrationsManager
- **Validation**: Zod (`zod/v4`), generated via Orval from OpenAPI
- **Build**: esbuild (CJS bundle for API), Vite (frontend)

## Structure

```text
artifacts/
├── api-server/         # Express 5 + Socket.io backend
│   └── src/
│       ├── lib/        # ollamaClient, taskStore, agentRunner
│       └── routes/     # health, tasks, ai, logs
└── cortexflow/         # React + Vite frontend
    └── src/
        ├── components/ # chat-interface, thinking-steps, browser-view, task-sidebar
        ├── hooks/      # use-socket, use-agent-state
        └── pages/      # dashboard
lib/
├── api-spec/           # OpenAPI spec + Orval codegen config
├── api-client-react/   # Generated React Query hooks
└── api-zod/            # Generated Zod schemas
```

## Key Features

- **Real-time task execution** via Socket.io (path: `/api/socket`)
- **AI thinking steps**: OBSERVE → THINK → PLAN → ACT → VERIFY
- **Multi-model support**: Ollama local models (auto-detected), simulation fallback
- **Browser agent control panel** with tab navigation
- **Task management**: create, execute, monitor tasks with status tracking
- **Execution logs** viewer
- **Arabic + English UI** support (thinking step labels in Arabic)

## AI Models

The platform uses Ollama for local AI. To enable real AI:
1. Install Ollama: https://ollama.ai
2. Pull a model: `ollama pull llama3`
3. Ollama runs at `localhost:11434` — auto-detected on startup

Without Ollama, the system runs in simulation mode with informative responses.

## API Endpoints

- `GET /api/healthz` — Health check + Ollama status
- `GET /api/tasks` — List all tasks
- `POST /api/tasks` — Create task (`description`, `type`: browser/system/ai/research)
- `GET /api/tasks/:id` — Get task
- `POST /api/tasks/:id/execute` — Execute task (AI agent runs through steps)
- `GET /api/ai/models` — List available Ollama models
- `POST /api/ai/chat` — Chat with AI (`messages` array)
- `GET /api/logs` — Get execution logs

## Socket.io Events

Server emits: `taskCreated`, `taskStart`, `taskSuccess`, `taskFail`, `thinking`, `taskUpdate`, `status`
Client emits: `submitTask`, `executeTask`, `getStatus`

## Root Scripts

- `pnpm run build` — runs typecheck then builds all packages
- `pnpm run typecheck` — full TypeScript check across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate Zod + React Query hooks
