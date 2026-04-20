# AGENTS.md

Quick-reference for future OpenCode sessions working in this repo.

## Project

OpenCode Outpost — a Telegram bot client for [OpenCode](https://opencode.ai). Bridges Telegram chat to a local OpenCode server via SSE + REST API. Fork of `grinev/opencode-telegram-bot`, significantly expanded.

## Commands

```bash
npm run build          # tsc (required before start/dev)
npm run dev            # build + start
npm start              # node dist/index.js (must build first)
npm test               # vitest run
npm run test:coverage  # vitest run --coverage
npm run lint           # eslint src --ext .ts --max-warnings=0
npm run format         # prettier --write "src/**/*.ts"
```

No watch mode is configured. No codegen scripts exist.

## Architecture

### Two entrypoints

- `src/index.ts` — runtime mode `"sources"` (default for `npm run dev`). Reads `.env` from CWD.
- `src/cli.ts` — runtime mode `"installed"` (default for `npx @tbosancheros39/opencode-outpost`). Reads `.env` from platform-specific config dir (`~/.config/opencode-outpost/` on Linux). Includes `config` wizard and `doctor` subcommands.

The `--mode` flag overrides: `opencode-outpost start --mode sources|installed`.

### Runtime modes

- **sources**: Config lives in project root (`.env`, `settings.json`). Used during development.
- **installed**: Config lives in `~/.config/opencode-outpost/` (Linux), `~/Library/Application Support/opencode-outpost/` (macOS), `%APPDATA%/opencode-outpost/` (Windows). Used for npm global install.

`OPENCODE_TELEGRAM_HOME` env var overrides the config directory in either mode.

### Key modules

| Directory | Purpose |
|-----------|---------|
| `src/bot/commands/` | 35 Telegram command handlers |
| `src/bot/handlers/` | Message routing (agent, voice, document, inline query, permission) |
| `src/bot/middleware/` | Auth, rate-limit, chat-concurrency, interaction-guard |
| `src/bot/streaming/` | Response + tool-call streaming to Telegram |
| `src/opencode/` | OpenCode SDK client (`@opencode-ai/sdk/v2`) and SSE event listener |
| `src/queue/` | BullMQ task queue with in-memory fallback when Redis unavailable |
| `src/task-queue/` | SQLite-backed persistent task store (better-sqlite3, WAL mode) |
| `src/safety/` | Bubblewrap sandbox, env sanitizer, command classifier, path validator |
| `src/runtime/` | Mode resolution, path resolution, config wizard bootstrap |
| `src/i18n/` | 7 locales (en, de, es, fr, ru, zh, bs) |
| `src/monitoring/` | OpenCode watchdog (auto-restart), journal monitor, system monitor |
| `src/telegram/render/` | MarkdownV2 rendering pipeline (remark-gfm → chunker → Telegram) |
| `src/session/` | Session cache manager, auto-resume last session |
| `src/summary/` | Response aggregation (streaming partial → complete → Telegram message) |

### Singleton managers

Many modules export singleton instances that hold state. Tests must call `resetSingletonState()` (in `tests/helpers/reset-singleton-state.ts`) between tests. The test setup file (`tests/setup.ts`) handles this automatically via `beforeEach`/`afterEach`.

Affected singletons: `questionManager`, `permissionManager`, `renameManager`, `interactionManager`, `summaryAggregator`, `keyboardManager`, `pinnedMessageManager`, `processManager`, `stopEventListening`, `__resetSessionDirectoryCacheForTests`.

### Queue fallback

If Redis is unavailable (`REDIS_ENABLED=false` or connection fails), the app falls back to `MemoryQueue` (in-memory FIFO). BullMQ features (persistence, retries) are lost in this mode. The app logs a warning and continues.

## Testing

- Framework: **Vitest** with `environment: "node"`
- Setup: `tests/setup.ts` — sets required env vars and resets singletons
- Test env defaults are in `tests/helpers/test-environment.ts` (sets `TELEGRAM_BOT_TOKEN`, `OPENCODE_MODEL_PROVIDER`, etc.)
- Tests live in `tests/` mirroring `src/` structure
- 88 test files, no test files in `src/` (tsconfig excludes `**/*.test.ts`)
- Run a single test: `npx vitest run tests/bot/commands/start.test.ts`
- Run a directory: `npx vitest run tests/bot/commands/`
- Coverage includes `src/**/*.ts`, excludes test files

### Test env gotchas

- `TELEGRAM_ALLOWED_USER_ID` (singular) is used in test defaults, but production uses `TELEGRAM_ALLOWED_USER_IDS` (plural). The config reads the plural form.
- `OPENCODE_TELEGRAM_HOME` is set to `.tmp/test-home/{pid}-{worker}` to isolate test state.
- Tests use `vi.stubAllEnvs()` / `vi.unstubAllEnvs()` for env var manipulation.

## Build & Type System

- **TypeScript** with `module: "NodeNext"`, `moduleResolution: "NodeNext"` — all local imports use `.js` extensions
- **Target**: ES2022
- **Strict mode** enabled
- **Declaration files** generated (`declaration: true`)
- Output: `dist/` (gitignored)
- `tsconfig.json` excludes `**/*.test.ts` from compilation

### Import convention

All local imports use `.js` extension despite being TypeScript files:
```typescript
import { config } from "../config.js";
```
This is required by `NodeNext` module resolution. Do not use `.ts` extensions.

## ESLint

- Config: `eslint.config.js` (flat config format)
- **`no-console: "error"`** — use `src/utils/logger.ts` instead. Only `logger.ts`, `src/setup/**/*.ts`, and `src/cli/doctor.ts` are exempted.
- `@typescript-eslint/no-explicit-any: "warn"` — avoid `any`, use proper types
- `@typescript-eslint/no-unused-vars: ["warn", { argsIgnorePattern: "^_" }]` — prefix unused params with `_`

## Dependencies

### Required services

- **Redis** — required for BullMQ task queue. Falls back to in-memory queue if unavailable.
- **OpenCode server** — must be running at `http://localhost:4096` (or `OPENCODE_API_URL`). Start with `opencode serve`.

### Key dependencies

- `grammy` — Telegram Bot framework
- `@opencode-ai/sdk` — OpenCode API client (uses `/v2` export)
- `bullmq` + `ioredis` — task queue
- `better-sqlite3` — persistent task storage (native addon, requires build tools)
- `remark-gfm` + `remark-parse` + `unified` — MarkdownV2 rendering pipeline

### Native dependency note

`better-sqlite3` requires C++ build tools (`python3`, `make`, `g++`). If install fails on missing native deps, check build toolchain first.

## Config

All config via environment variables (loaded by `dotenv` from the mode-appropriate `.env` file). See `.env.example` for the full list (41 variables).

Required: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, `OPENCODE_MODEL_PROVIDER`, `OPENCODE_MODEL_ID`.

The config module (`src/config.ts`) is loaded eagerly at import time — it reads env vars immediately. Tests must set env vars before importing config-dependent modules.

## npm Package

Published as `@tbosancheros39/opencode-outpost` on npm. The `files` field in `package.json` only includes `dist/`, `README.md`, `LICENSE.md`, `.env.example`.

CLI entrypoint: `dist/cli.js` (via `bin.opencode-outpost`).

## Release Scripts

- `npm run release:prepare` — runs `scripts/release-prepare.mjs`
- `npm run release:rc` — runs `scripts/release-prepare.mjs rc`
- `npm run release:notes:preview` — runs `scripts/release-notes-preview.mjs`

These scripts are not in the repo (in `.gitignore` or `.tmp/`). They may need to be created or are local-only.