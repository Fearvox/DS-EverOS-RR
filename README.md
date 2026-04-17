# DS-EverOS-RR

> **Dash Shatter × EverOS — Refactor Request**
> A sanitized sandbox of the reverse-engineered Claude Code CLI (**CCR**), cut down to only the parts needed to reproduce and investigate an outstanding P0 bug: **REPL input silently swallows API requests after `UserPromptSubmit` hook processing**.

This repo is **not** a full fork of Claude Code. It is a debugging & refactoring sandbox prepared for collaborative work with the EverOS / EverMind team.

---

## Quick context

- Runtime: **Bun 1.3.x** (not Node)
- Module system: ESM + TSX (`react-jsx`)
- Tests: built-in `bun test` — **1286 tests, 0 fail** currently (see `tests/` + `services/`)
- Build: `bun build src/entrypoints/cli.tsx --outdir dist --target bun` → single-file 27 MB bundle
- Origin: decompiled from the official Claude Code CLI, then extensively refactored. **Many files still carry React Compiler `_c()` memoization artifacts and decompiled type noise** — this is expected, not a bug.

## What's working vs. not

| Area | Status |
|---|---|
| `bun run build` | ✅ clean, 650ms, no errors |
| `bun test tests/` | ✅ 746/746 pass |
| `bun services/run-tests.ts` | ✅ 516/516 pass |
| `bun run src/entrypoints/cli.tsx --version` | ✅ prints version |
| `bun run src/entrypoints/cli.tsx --help` | ✅ full command list |
| **REPL `say hi` → expect reply** | ❌ **silent swallow** — see [`REPRO.md`](./REPRO.md) |
| Opus 4.7 model registration | ✅ works (new `CAPABILITY_REGISTRY`) |
| `--effort xhigh` CLI flag | ✅ accepted, downgrades on non-4.7 models |

## Quick start

```bash
# Install
bun install

# Run dev REPL (will hit the silent-swallow bug on first message)
bun run dev

# Build + run binary
bun run build
bun run dist/cli.js

# Full regression
bun run build && bun test tests/ && bun services/run-tests.ts
```

## The bug in one sentence

> User types a prompt → `handlePromptSubmit` fires → `processUserInput` → `processTextPrompt` logs `user_prompt` OTel event → spinner starts (caffeinate on) → 5 seconds later spinner dies (caffeinate off) → **no API call is ever made, no UI error is ever rendered**.

Full investigation notes and reproduction steps: [`REPRO.md`](./REPRO.md)
Architecture overview: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## Licensing & origin

Code derives from the decompiled Claude Code CLI plus substantial independent refactoring. See [`LICENSE`](./LICENSE).

This sandbox intentionally strips all private data — no benchmarks, no research notes, no proprietary docs, no credentials. Only the code and its bug.
