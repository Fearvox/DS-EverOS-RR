# Architecture

High-level map of the CCR (Claude Code Reimagine) codebase sitting in this repo. This is condensed from the longer internal doc; only the parts relevant to understanding the bug and contributing a fix are here.

## Runtime & build

- **Runtime**: Bun only (not Node). All imports, builds, execution use Bun APIs.
- **Build**: `bun build src/entrypoints/cli.tsx --outdir dist --target bun` — single-file 27 MB bundle.
- **Module system**: ESM (`"type": "module"`), TSX with `react-jsx` transform.
- **Monorepo**: Bun workspaces — internal packages in `packages/` resolved via `workspace:*`.

## Entry & bootstrap

1. **`src/entrypoints/cli.tsx`** — True entrypoint. Injects runtime polyfills:
   - `feature()` always returns `false` (all decompiled feature flags disabled by default — unimplemented branches are skipped)
   - `globalThis.MACRO` — simulates build-time macro injection (VERSION, BUILD_TIME, etc.)
   - `BUILD_TARGET`, `BUILD_ENV`, `INTERFACE_TYPE` globals
2. **`src/main.tsx`** — Commander.js CLI. Parses args, inits services, launches REPL or pipe mode.
3. **`src/entrypoints/init.ts`** — One-time init.

## Core loop

- **`src/query.ts`** — Main API query function. Sends messages to the Anthropic API, handles streaming, processes tool calls, manages the conversation turn loop.
- **`src/QueryEngine.ts`** — Higher-level orchestrator wrapping `query()`. Manages conversation state, compaction, file history snapshots, turn bookkeeping.
- **`src/screens/REPL.tsx`** — Interactive REPL (React/Ink). Handles input, message display, tool permission prompts, keyboard shortcuts.

## API layer

- **`src/services/api/claude.ts`** — Core API client. Builds request params (system prompt, messages, tools, betas), calls the Anthropic SDK streaming endpoint, processes `BetaRawMessageStreamEvent` events.
- Supports providers: Anthropic direct, AWS Bedrock, Google Vertex, Azure Foundry.
- Provider selection: `src/utils/model/providers.ts`.

## User-input pipeline (where the silent-swallow bug lives)

```
REPL (user types) → onSubmit handler in REPL.tsx
  → handlePromptSubmit  (src/utils/handlePromptSubmit.ts)
      → executeUserInput
          → processUserInput  (src/utils/processUserInput/processUserInput.ts)
              → UserPromptSubmit hooks  (src/utils/hooks.ts)
              → processUserInputBase
                  → processTextPrompt  (src/utils/processUserInput/processTextPrompt.ts)
                      → logOTelEvent('user_prompt', ...)   ← we know this runs
                      → ...                                  ← but we don't know what happens after
              ← returns { messages: [...], shouldQuery: true }
          ← if newMessages.length > 0: await onQuery(...)
                                           ↓
                                       finally: queryGuard.cancelReservation → isLoading=false
```

See [`REPRO.md`](./REPRO.md) for the full investigation.

## Tool system

- **`src/Tool.ts`** — Tool interface definition + utilities.
- **`src/tools.ts`** — Tool registry. Conditionally loads tools via `feature()` flags.
- **`src/tools/<ToolName>/`** — Each tool in own dir (e.g., `BashTool`, `FileEditTool`, `GrepTool`, `AgentTool`).
- Tools define: `name`, `description`, `inputSchema` (JSON Schema), `call()` (execution), optional React component for result rendering.

## UI layer (Ink)

- **`src/ink.ts`** — Ink render wrapper with ThemeProvider injection.
- **`src/ink/`** — Custom Ink framework fork: custom reconciler, hooks (`useInput`, `useTerminalSize`, etc.), virtual list rendering.
- **`src/components/`** — React components rendered in terminal via Ink:
  - `App.tsx` — Root provider (AppState, Stats, FpsMetrics)
  - `Messages.tsx` / `MessageRow.tsx` — Conversation rendering
  - `PromptInput/` — User input handling
  - `permissions/` — Tool permission approval UI
- Components use React Compiler runtime (`react/compiler-runtime`) — decompiled output has `_c()` memoization calls throughout. **Normal, not a bug.**

## State management

- **`src/state/AppState.tsx`** — Central app state type + context provider.
- **`src/state/store.ts`** — Zustand-style store.
- **`src/bootstrap/state.ts`** — Module-level singletons for session-global state.

## Context & system prompt

- **`src/context.ts`** — Builds system/user context for API call.
- **`src/utils/claudemd.ts`** — Discovers + loads CLAUDE.md files from project hierarchy.

## Model capability registry (recently refactored)

- **`src/utils/model/capabilities.ts`** — Single source of truth for per-model capability flags (effort/maxEffort/xhighEffort/adaptiveThinking/structuredOutputs/autoMode/supports1m/knowledgeCutoff/marketingName/frontier).
- **`src/utils/model/defineModel.ts`** — DSL for registering a new model in one call.
- **`src/utils/model/configs.ts`** — Provider-specific model ID mappings.
- `effort.ts` / `thinking.ts` / `betas.ts` / `context.ts` / `prompts.ts`'s `getKnowledgeCutoff` all now route through `getCapability(model, key)`.

Parity tests in `tests/model-capabilities.test.ts` guarantee behavioral equivalence with the pre-refactor pattern-matching. **Please do not touch this subsystem when fixing the silent-swallow bug** unless strictly necessary.

## Feature flag system

All `feature('FLAG_NAME')` calls come from `bun:bundle` (build-time API). In the decompiled version here, `feature()` is polyfilled to always return `false` in `cli.tsx`. All Anthropic-internal features (COORDINATOR_MODE, KAIROS, PROACTIVE, etc.) are therefore disabled by default and their code paths are effectively dead.

User-level flag overrides live in `~/.claude/feature-flags.json` at runtime.

## Stubbed / deleted modules

| Module | Status |
|---|---|
| Computer Use (`@ant/*`) | Stub packages in `packages/@ant/` |
| `*-napi` packages (audio, image, url, modifiers) | Stubs in `packages/` (except `color-diff-napi` which is fully implemented) |
| Analytics / GrowthBook / Sentry | Empty implementations |
| Magic Docs / Voice Mode / LSP Server | Removed |
| Plugins / Marketplace | Removed |
| MCP OAuth | Simplified |

## Working with this codebase

- **Don't try to fix all tsc errors** — there are ~1,300, inherited from decompilation, and they don't affect the Bun runtime. Targeted type cleanups are fine; mass rewrites break things.
- **`feature()` always returns `false`** — code behind a feature flag is dead code in this build.
- **React Compiler output** — components have decompiled memoization boilerplate (`const $ = _c(N)`). Normal.
- **`bun:bundle` import** — in `src/main.tsx` etc., `import { feature } from 'bun:bundle'` works at build time. At dev time, a polyfill in `cli.tsx` provides it.
- **`src/` path alias** — `tsconfig.json` maps `src/*` to `./src/*`. Imports like `import { ... } from 'src/utils/...'` are valid.
