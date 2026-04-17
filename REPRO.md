# Silent Swallow — P0 Bug Reproduction

## TL;DR

The CCR REPL silently drops user messages. Spinner starts, `caffeinate` prevents sleep for ~5 seconds, then the loading state ends — but **no HTTP request is ever sent** and **no UI message is ever rendered**. Both the success and the error paths fail to surface anything to the user.

## Symptoms

Running `bun run dev` (or `bun run dist/cli.js`), enter any prompt (e.g. `say hi`):

1. ⏳ Spinner appears briefly
2. `[DEBUG] Started caffeinate to prevent sleep` is logged
3. ~5 seconds later: `[DEBUG] Stopped caffeinate, allowing sleep`
4. Spinner disappears
5. **REPL returns to an idle prompt with no output, no error, no assistant message**

## Environment

- macOS 15.x (Darwin 24.6.0)
- Bun 1.3.11
- Fresh `bun install` from this repo
- Tested with both provider proxies (OpenAI-format relay) and direct Anthropic — same symptom on both when the bug is hit
- Reproduces on both `bun run dev` (watch mode) and `bun run dist/cli.js` (static bundle)

## What we already verified

| Check | Result |
|---|---|
| `bun run build` | ✅ clean |
| `bun test tests/` | ✅ 746/746 pass |
| `bun services/run-tests.ts` | ✅ 516/516 pass |
| `--version`, `--help` | ✅ work |
| Direct `curl` to Anthropic `/v1/messages` with OAuth token | ✅ reachable (returned `rate_limit_error` on Opus 4.7 which is an after-launch-day expected 429 — **unrelated**) |
| OAuth token stored in keychain | ✅ valid, loaded (session `/status` shows Claude Max Account) |
| Model picker correctly resolves `claude-opus-4-7[1m]` | ✅ works |

## Investigation trace (from a real `--debug-file` run)

```
SessionStart hook enumerates ~200 skills (normal)
...
[DEBUG] [handlePromptSubmit] queryGuard.isActive=false isExternalLoading=false input="say hi"   ← handler fires
...
[DEBUG] [3P telemetry] Event dropped (no event logger initialized): user_prompt                 ← processTextPrompt.ts:52 was reached
[DEBUG] Started caffeinate to prevent sleep                                                      ← isLoading became true
(5-second gap, no further log lines)
[DEBUG] Stopped caffeinate, allowing sleep                                                       ← isLoading became false
```

The critical observation:

- `processTextPrompt` ran (the `user_prompt` OTel event is only emitted from its body at `src/utils/processUserInput/processTextPrompt.ts:52`),
- But the surrounding `executeUserInput` never logs `query_process_user_input_end` (added as a debug instrumentation) and never calls `onQuery`.
- There is **no error**, no `[ERROR]` line, no stack trace, no `[WARN]` beyond the benign telemetry-drop.

So: **control leaves `processTextPrompt` via an early-return or an uncaught rejected `await`, and the outer `executeUserInput` try/finally winds down quietly** — the `finally` at `handlePromptSubmit.ts:598` releases `queryGuard`, which flips `isLoading` to false, which causes the `stopPreventSleep` effect to fire.

## Suspected area

The silent path lives somewhere in this chain:

```
src/utils/handlePromptSubmit.ts
  └─ executeUserInput()           ← L397
      └─ await runWithWorkload(turnWorkload, async () => {
            └─ processUserInput()  ← L477
                 └─ processUserInputBase()
                      └─ processTextPrompt()   ← src/utils/processUserInput/processTextPrompt.ts
                           └─ logOTelEvent('user_prompt', ...)  ← L52  ✓ reached
                           └─ (...everything after this is the suspect...)
      })
```

And possibly interacts with:

- `UserPromptSubmit` hook output parsing — `src/utils/hooks.ts` `parseHookOutput` distinguishes JSON vs plain-text output. A third-party plugin (PUA / EverMem) injecting plain-text XML as `additionalContext` seems to be part of the issue but **disabling PUA's `UserPromptSubmit` hook alone does not resolve the swallow**.
- `queryGuard` lifecycle in `src/services/queryGuard.ts` — `isActive` flips back correctly, so the guard itself appears honest.

## Pre-added debug instrumentation

We injected an extra log at the seam in `src/utils/handlePromptSubmit.ts` (search for `[executeUserInput] processUserInput done`). Running the REPL and triggering the bug, that line **is expected to appear** in `--debug-file`. **If it does not appear**, the fault is inside `processUserInput` or earlier; if it does appear with `newMessages.length=0`, the fault is in the hook→message-collection path.

We also neutralized one third-party plugin's `UserPromptSubmit` hook by emptying the `UserPromptSubmit` array in `~/.claude/plugins/cache/pua-skills/pua/*/hooks/hooks.json` and the parallel copy in `~/.claude/plugins/marketplaces/pua-skills/hooks/hooks.json` — **bug still reproduces after that**, so while that plugin is a contributor, it isn't the sole root cause.

## How to reproduce cleanly

```bash
# 1. Install
bun install

# 2. Rebuild to pick up the pre-added debug instrumentation
bun run build

# 3. Clear any stale debug log
: > /tmp/ccr-live.log

# 4. Run (don't use `bun run dev` — use the static bundle to rule out watch-reload)
bun run dist/cli.js --debug-file /tmp/ccr-live.log

# 5. In the REPL, type:
say hi

# 6. Wait 5 seconds. Spinner will disappear with no reply.

# 7. From another terminal:
grep -nE "handlePromptSubmit|executeUserInput|processUserInput|user_prompt|query_process_user_input|query_hooks|queryGuard" /tmp/ccr-live.log
```

The grep output shows which of the 4 instrumented stages the control flow reaches. Post the output in the issue / PR — it pins the failure to one concrete line range.

## What a good fix looks like

1. Locate the `await` in `processTextPrompt` (or its descendants) whose rejection / early-return is being swallowed.
2. Either:
   - Propagate the error up to the user with a system message (at minimum), **or**
   - Ensure the code path always produces at least one message so `executeUserInput` falls into the `newMessages.length > 0` branch at `handlePromptSubmit.ts:542` and reaches `onQuery`.
3. Add a regression test in `tests/` that simulates a plain-text `UserPromptSubmit` hook output + a simple user message and asserts `onQuery` is invoked.

## Scope guardrails for the collaborator

- Do **not** touch model capability code (`src/utils/model/capabilities.ts`, `src/utils/model/configs.ts`, `src/utils/model/defineModel.ts`) — those were just refactored and have full parity tests.
- Do **not** add new runtime dependencies — keep the build single-file.
- Do **not** reintroduce Node-only APIs — Bun is the sole runtime.
- **Do** add defensive instrumentation; the codebase is already `logForDebugging`-heavy and one more well-placed log is fine.
- **Do** prefer returning a visible system error over silent swallowing at every boundary you touch.

## Out of scope (but context)

The codebase also has a longer-term refactor roadmap in `docs/superpowers/plans/` — a "model capability registry" task already landed (see `src/utils/model/capabilities.ts`), and there is appetite for:

- Splitting the 600+ line `api/relay/index.ts` into `{handler, transforms, auth, debug}.ts`
- Unifying scattered `isMaxSubscriber / isProSubscriber / isTeamSubscriber` calls behind a single entitlement API
- Scrubbing the decompiled React Compiler `_c()` memoization noise (codemod candidate)

All of these are welcome follow-ups **after** the silent-swallow root cause is pinned.
