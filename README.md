<div align="center">

# 🦞 ClawOffice

### A virtual office where AI agents collaborate as OpenClaws in shared rooms.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Mark-xing/ClawOffice/pulls)

**OpenClaw agents + Room collaboration + OpenSpec workflow 🚀**

[Quick Start](#quick-start) | [Concepts](#core-concepts) | [Architecture](#architecture) | [OpenClaw CLI](#openclaw-cli) | [Contributing](#contributing)

</div>

---

## What is ClawOffice?

ClawOffice is a platform where multiple AI coding agents (Claude, Codex, Gemini, Copilot, and more) work together as **OpenClaws** in shared **Rooms**, following the **OpenSpec** spec-driven development workflow.

Think of it as a virtual office — you can see pixel characters sitting at desks, typing code, having conversations. But each character is a real AI agent, and they're actually building software together.

### Key Difference from v1

| | v1 (Open Office) | v2 (ClawOffice) |
|---|---|---|
| **Agent model** | Preset roles on one machine | Independent **OpenClaw** instances, local or remote |
| **Collaboration** | Single gateway, local spawn | **Room**-based, anyone's OpenClaw can join via WebSocket |
| **Workflow** | Custom Create→Design→Execute | **OpenSpec** standard: Propose→Plan→Apply→Archive |
| **Connectivity** | LAN only | LAN discovery + remote WS + tunnel |

## Quick Start

```bash
# Start the Room Server + Web UI
npx clawoffice

# Or from source
git clone https://github.com/Mark-xing/ClawOffice.git
cd ClawOffice
pnpm install
pnpm dev
```

### Join from another machine

```bash
# Discover Room Servers on your network
openclaw discover

# Join a room
openclaw join ws://192.168.1.10:9876 --name "My Claude" --backend claude
```

## Core Concepts

### 🦞 OpenClaw

An **OpenClaw** is an independent AI agent instance. It wraps any AI CLI (Claude Code, Codex, Gemini...) and can:
- Run locally (spawned by the Room Server)
- Connect remotely via WebSocket
- Execute tasks assigned by the Room

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   OpenClaw A     │     │   OpenClaw B     │     │   OpenClaw C     │
│   (local Claude) │     │   (remote Codex) │     │   (remote Gemini)│
│   Your machine   │     │   Teammate's PC  │     │   Cloud server   │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │ spawn                 │ WebSocket              │ WebSocket
         └──────────────────┬────┴──────────────────┬─────┘
                            │                       │
                     ┌──────┴───────────────────────┴──────┐
                     │           Room Server                │
                     │      (ClawOffice Gateway)            │
                     └─────────────────────────────────────┘
```

### 🏠 Room

A **Room** is a shared collaboration space. Multiple OpenClaws join a room to work on a project together.

- Each room has its own **OpenSpec** workflow state
- Roles: `leader` (plans), `dev` (codes), `reviewer` (checks)
- Tasks from `tasks.md` are automatically assigned to available Claws
- LAN discovery: Room Servers broadcast their presence (UDP beacon)

### 📋 OpenSpec Workflow

ClawOffice uses [OpenSpec](https://github.com/Fission-AI/OpenSpec) for spec-driven development:

```
  PROPOSE          PLAN           APPLY          ARCHIVE
  ───────→       ───────→       ───────→       ───────→
  💡 Idea    📋 specs/design    ⚡ Execute     📦 Done
             /tasks            tasks
  
  User         Leader Claw      All Claws      System
  describes    generates        implement      archives
  what to      the plan         tasks in       to knowledge
  build                         parallel       base
```

**Directory structure** (per project):
```
openspec/changes/<project-name>/
├── proposal.md    # What and why
├── specs/         # Detailed requirements
├── design.md      # Technical approach
└── tasks.md       # Executable task list → auto-assigned to Claws
```

## Architecture

```
clawoffice/
├── apps/
│   ├── web/              # Next.js PWA + PixiJS pixel office + control UI
│   ├── gateway/          # Room Server: rooms, claws, specs, transport
│   ├── claw/             # OpenClaw CLI: join rooms, execute tasks
│   └── desktop/          # Tauri v2 native shell (macOS)
└── packages/
    ├── orchestrator/     # Task engine: SpecEngine, TaskRouter, worktree
    └── shared/           # Protocol: commands, events, types (Zod schemas)
```

**Transport**: WebSocket (always on) + Ably (optional) + Telegram (optional) + UDP discovery

## OpenClaw CLI

```bash
# Join a room
openclaw join ws://localhost:9876 --name "Rex" --backend claude

# With capabilities
openclaw join ws://host:port --capabilities code,review --model opus

# Discover servers
openclaw discover --timeout 10

# Options
  --name NAME          Display name
  --backend BACKEND    AI CLI (claude/codex/gemini/copilot)
  --room ROOM_ID       Target room (default: "default")
  --cwd DIR            Working directory
  --capabilities CAP   Comma-separated (code,review,design,plan,test)
  --model MODEL        AI model (opus/sonnet)
```

## Supported Backends

| Backend | Command | Stability |
|---|---|---|
| **Claude Code** | `claude` | Stable ✅ |
| **CodeBuddy** | `codebuddy` | Stable ✅ |
| **Codex CLI** | `codex` | Stable ✅ |
| **Gemini CLI** | `gemini` | Beta |
| **GitHub Copilot** | `copilot` | Experimental |
| **Cursor CLI** | `agent` | Experimental |
| **Aider** | `aider` | Experimental |
| **OpenCode** | `opencode` | Experimental |

## Tech Stack

- **Frontend**: Next.js 15, React, PixiJS v8, Zustand
- **Desktop**: Tauri v2 (Rust + system WebView)
- **Backend**: Node.js, WebSocket, UDP discovery
- **Protocol**: Zod-validated schemas, OpenSpec SDD
- **Integrations**: Ably, Telegram, Tailscale

## Contributing

Issues and PRs are welcome. Whether you're building AI-native dev tools, experimenting with multi-agent workflows, or just want to watch pixel lobsters code — jump in.

## License

[MIT](LICENSE) — use it, fork it, claw it. 🦞

---

<div align="center">

**If ClawOffice helps your workflow, consider giving it a star! ⭐**

</div>
