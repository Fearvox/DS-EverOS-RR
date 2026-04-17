# Silent Swallow — P0 Bug Reproduction

## TL;DR

The CCR REPL silently drops user messages. Spinner starts, `caffeinate` prevents sleep for **exactly 5 seconds**, then the loading state ends — but **no HTTP request is ever sent** and **no UI message is ever rendered**.

The 5-second constant is not coincidental: it matches `HOOK_TIMEOUT_MS = 5000` in `src/utils/processUserInput/processUserInput.ts:182`. The `UserPromptSubmit` hook iterator hangs waiting for its next event, hits the timeout, and silently breaks out — leaving `executeUserInput` without any collected messages, so `onQuery` is never called.

## Symptoms

Running `bun run dev` (or `bun run dist/cli.js`), enter any prompt (e.g. `say hi`):

1. ⏳ Spinner appears briefly
2. `[DEBUG] Started caffeinate to prevent sleep` is logged
3. ~5 seconds later: `[DEBUG] Stopped caffeinate, allowing sleep`
4. Spinner disappears
5. **REPL returns to an idle prompt with no output, no error, no assistant message**

## Real log timeline (anonymized, from a real `--debug-file` run)

```
04:40:30.671  [handlePromptSubmit] queryGuard.isActive=false isExternalLoading=false input="say hi"
04:40:30.696  [WARN] [3P telemetry] Event dropped (no event logger initialized): user_prompt
              ↑ processTextPrompt.ts:52 — processTextPrompt ran and fired its OTel event
04:40:30.737  [DEBUG] Started caffeinate to prevent sleep
              ↑ isLoading = true (queryGuard reserved by executeUserInput)

  ...  5.008 seconds of silence  ...
       ↑ HOOK_TIMEOUT_MS = 5000 in processUserInput.ts:182

04:40:35.745  [DEBUG] Stopped caffeinate, allowing sleep
              ↑ isLoading = false (queryGuard released in the `finally`)
```

Notice what is **absent**:

- No `[executeUserInput] processUserInput done` (we added an instrumentation log at `handlePromptSubmit.ts:528` that runs *after* the `processUserInput` call returns — it never fires)
- No `query_process_user_input_end` checkpoint
- No `onQuery` entry
- No `POST /v1/messages`
- No visible user or assistant message in the REPL

## Root cause (narrowed down)

The chain reaches `processUserInput` → `processUserInputBase` → `processTextPrompt` (which fires `user_prompt` OTel at line 52 and returns synchronously). Control returns to `processUserInput`, which then enters the `UserPromptSubmit` hook iterator at `processUserInput.ts:185`:

```ts
const HOOK_TIMEOUT_MS = 5000
...
const hookIterator = executeUserPromptSubmitHooks(inputMessage, ...)

for await (const hookResult of {
  [Symbol.asyncIterator]() {
    return {
      async next() {
        const elapsed = Date.now() - hookStartTime
        if (elapsed > HOOK_TIMEOUT_MS) {
          logForDebugging(`[hooks] UserPromptSubmit timed out after ${elapsed}ms — skipping remaining hooks`)
          return { done: true, value: undefined }
        }
        const result = await Promise.race([
          hookIterator.next(),
          new Promise(resolve => setTimeout(() => {
            hookTimedOut = true
            logForDebugging(...)
            resolve({ done: true, value: undefined })
          }, HOOK_TIMEOUT_MS - elapsed)),
        ])
        return result
      },
    },
  },
}) { ... }
```

The iterator races `hookIterator.next()` against a 5-second timer. In the failing repro, `hookIterator.next()` never resolves — which means `executeUserPromptSubmitHooks` is `await`-ing on an underlying hook child-process or plugin call that never signals completion.

After the timeout fires, the outer `for await` exits with `done: true`. The code then proceeds, but because **no hook yielded any result** (no `additionalContexts`, no blocking error, no message), `result.messages` on return from `processUserInputBase` contains **only** the user message from `processTextPrompt`. Why then does `newMessages` end up empty at `handlePromptSubmit.ts:542`?

Something between the hook-iterator timeout and the `newMessages.push(...result.messages)` at L514 swallows the user message. That is the exact bug to find.

## Contributing hook sources (all of these inject into UserPromptSubmit)

```
~/.claude/plugins/cache/evermem/evermem/0.1.3/hooks/hooks.json
  → node inject-memories.js          (timeout 10s)
~/.claude/plugins/cache/claude-plugins-official/vercel/*/hooks/hooks.json
  → node user-prompt-submit-telemetry.mjs     (timeout 5s)
  → node user-prompt-submit-skill-inject.mjs  (timeout 5s)   ← emits ~200 "Skill prompt: showing ..." lines per turn
~/.claude/plugins/marketplaces/claude-plugins-official/plugins/hookify/hooks/hooks.json
  → python3 userpromptsubmit.py      (timeout 10s)
~/.claude/plugins/cache/pua-skills/pua/3.1.0/hooks/hooks.json
  → bash frustration-trigger.sh      (timeout 5s) — outputs PLAIN TEXT (not JSON), which parseHookOutput handles via the `plainText` branch at hooks.ts:406
```

When all five `UserPromptSubmit` hook arrays are **emptied** (`.hooks.UserPromptSubmit = []` via `jq`), the silent-swallow **still reproduces**. That means the bug lives in the CCR iterator machinery itself, not in any one hook. The hooks only make the symptom louder.

## Environment

- macOS 15.x (Darwin 24.6.0)
- Bun 1.3.11
- Tested with both `bun run dev` (watch mode) and `bun run dist/cli.js` (static bundle) — both fail identically
- Direct `curl` to Anthropic `/v1/messages` with OAuth token succeeds (API is reachable; the bug is purely client-side)

## Pre-added debug instrumentation

We injected an extra log at the boundary in `src/utils/handlePromptSubmit.ts:528`. Search for the literal `[executeUserInput] processUserInput done`. If it appears in `/tmp/ccr-live.log`, the fault is *after* `processUserInput` returns; if it does **not** appear, the fault is *inside* `processUserInput`'s hook iterator path — that is the state we observed.

## How to reproduce cleanly

```bash
# 1. Install
bun install

# 2. Rebuild to pick up the instrumentation above
bun run build

# 3. Clear any stale debug log
: > /tmp/ccr-live.log

# 4. Run the static bundle
bun run dist/cli.js --debug-file /tmp/ccr-live.log

# 5. In the REPL, type:
say hi

# 6. Wait 5 seconds. Spinner disappears with no reply.

# 7. From another terminal:
grep -nE "handlePromptSubmit|executeUserInput|processUserInput|user_prompt|caffeinate|Hook UserPromptSubmit|hook.*timed out" /tmp/ccr-live.log | tail -40
```

You should see the four log lines documented in the timeline above. You should **not** see `[executeUserInput] processUserInput done` or any `Hook UserPromptSubmit ... success` or `onQuery` line.

## What a good fix looks like

Two legitimate fixes, either independently or together:

1. **Make the hook iterator robust to hook commands that never return.** In `executeUserPromptSubmitHooks` (`src/utils/hooks.ts`), enforce a per-hook subprocess timeout with SIGKILL and yield a `{ outcome: 'error' }` result on timeout so the outer iterator receives a real signal rather than a silent `done: true`. The current outer 5-second race abandons the iterator but leaves downstream code unaware.
2. **When the hook iterator completes without producing any messages, still deliver the user's original message to `onQuery`.** At `processUserInput.ts`, after the `for await` loop, assert that `result.messages` already contains the user's turn (built by `processTextPrompt`). If a subsequent step drops it, log an error with `result` shape and re-add the base user message.

A regression test in `tests/` should simulate a UserPromptSubmit hook whose subprocess hangs forever and assert that the outer pipeline still produces a user message and reaches `onQuery` within ≤ 6 seconds.

## Scope guardrails for the collaborator

- Do **not** touch model capability code (`src/utils/model/capabilities.ts`, `src/utils/model/configs.ts`, `src/utils/model/defineModel.ts`) — those were just refactored and have full parity tests.
- Do **not** add new runtime dependencies — keep the build single-file.
- Do **not** reintroduce Node-only APIs — Bun is the sole runtime.
- **Do** add defensive instrumentation at every async boundary in `processUserInput`; the codebase is already `logForDebugging`-heavy and one more well-placed log is fine.
- **Do** prefer returning a visible system error over silent swallowing.

## Out of scope (but context)

The codebase also has a longer-term refactor roadmap under `docs/superpowers/plans/` — a "model capability registry" task already landed (see `src/utils/model/capabilities.ts`). Welcome follow-ups **after** the silent-swallow root cause is fixed:

- Splitting `api/relay/index.ts` into `{handler, transforms, auth, debug}.ts`
- Unifying `isMaxSubscriber / isProSubscriber / isTeamSubscriber` behind a single entitlement API
- Scrubbing decompiled React Compiler `_c()` memoization noise (codemod candidate)
