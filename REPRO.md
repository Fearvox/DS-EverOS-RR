# Silent Swallow — P0 Bug Reproduction

## TL;DR (Updated 2026-04-17 02:15 after 14h debug)

CCR REPL and pipe-mode (`-p`) both drop user messages silently.
The hang is reproducible from a clean shell, reachable after a single
`echo "say OK" | bun run dist/cli.js -p`, and survives every known
bypass: PUA/EverMem/Vercel/Hookify `UserPromptSubmit` hooks neutralized,
all MCP servers disabled (`--strict-mcp-config` + `ENABLE_CLAUDEAI_MCP_SERVERS=0`),
311-skill attachment suppressed (`CLAUDE_CODE_DISABLE_ATTACHMENTS=1`),
bare mode (`CLAUDE_CODE_SIMPLE=1`), Vercel plugin disabled at project
scope, project-level `ds` function.

The hang is **not in** user-visible code paths tested. It is an
**async await suspended** between `[STARTUP] MCP configs resolved in Xms`
and any subsequent query activity. TCP 443 to MiniMax lb-ali IP
(`47.252.72.253`) is **ESTABLISHED** but no HTTP request body appears to
be sent. No error, no retry, no stream-idle-timeout, no log line for
up to 3 minutes.

## The exact 50-line hang window

Localized to `src/main.tsx` between:

- Line 2389 — last log: `[STARTUP] MCP configs resolved in 1ms (awaited at +34ms)`
- Line 3200 — last log: `Found N plugins (M enabled, K disabled)` (from `pluginLoader.ts:3200` called from telemetry / prefetch path)
- After line 3200 — **total silence**, no further `logForDebugging` ever fires.

## Evidence timeline (clean repro, bare mode pipe)

```
06:03:04.963  GrowthBook: 1 override
06:03:04.977  Remote managed settings 404
06:03:04.990  Permission updates applied
06:03:04.990  [STARTUP] Loading MCP configs...
06:03:05.009  [STARTUP] Running setup()...
06:03:05.012  [bare] Skipping skill dir discovery (no --add-dir)
06:03:05.013  [STARTUP] setup() completed in 4ms
06:03:05.014  [STARTUP] Loading commands and agents...
06:03:05.020  getSkills returning: 0 skill dir, 0 plugin, 5 bundled
06:03:05.021  [STARTUP] Commands and agents loaded in 7ms
06:03:05.022  Skipping startup prefetches (last ran 1.7s ago)
06:03:05.022  [STARTUP] MCP configs resolved in 1ms (awaited at +32ms)
06:03:05.025  Fast mode unavailable
06:03:05.028  [auto-mode] kickOutOfAutoIfNeeded applying
06:03:05.045  Loaded 54 installed plugins
06:03:05.053  Plugin {typescript,pyright,csharp,...}-lsp: no entry.skills
06:03:05.054  Loaded hooks from vercel/evermem/security-guidance/hookify/ralph-loop/pua/superpowers/codex/learning-output-style
06:03:05.055  Found 50 plugins (39 enabled, 11 disabled)
 ─────────────  *** HANG — no log for 25+ seconds, process killed ***
```

## What we know about the network state during hang

`lsof -p <bun_pid>` shows one live HTTPS connection:

```
bun  31743  0xvox  17u  IPv4  ...  TCP  10.6.3.196:58536 -> 47.252.72.253:https (ESTABLISHED)
```

`dig +short api.minimax.io` resolves to exactly `47.252.72.253` (lb-ali.minimax.io, Alibaba Cloud LLC, US). So the TCP layer is fine — CCR has opened a keepalive socket to the provider. But no request body or response passes through; no log line mentions the POST, the first chunk, retries, or stream-idle-timeout.

## What we verified the bug is NOT

| Candidate | Ruled out by |
|---|---|
| MiniMax endpoint slow | Direct curl `/v1/messages` non-stream 2.9s / stream TTFB 1.1s (HTTP 200, full SSE) |
| Network / DNS | `lsof` shows live ESTABLISHED socket to correct IP |
| OAuth expiry | `settings.json.env.ANTHROPIC_AUTH_TOKEN` valid 125 chars; direct curl succeeds |
| PUA/EverMem/Vercel/Hookify `UserPromptSubmit` hooks | 6 `hooks.json` all `UserPromptSubmit: []` (backups kept with `.bak-*` suffix) |
| claude.ai MCP servers | `ENABLE_CLAUDEAI_MCP_SERVERS=0` gates them in `src/services/mcp/claudeai.ts:42` |
| Local MCP servers | `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` |
| Vercel plugin hooks | `plugins.vercel@claude-plugins-official: false` in project `.claude/settings.json` |
| 311-skill attachment | `CLAUDE_CODE_DISABLE_ATTACHMENTS=1` returns `[]` from `src/utils/attachments.ts:752-761` |
| Plugin auto-install hang | `CLAUDE_CODE_SIMPLE=1` bypasses `installPluginsForHeadless` completely — same hang |
| REPL-specific path | Pipe mode (`-p`) also hangs identically |
| Hook iterator 5s timeout | Now past timeout; no `Hook UserPromptSubmit timed out` log |
| Signature block / thinking-only response | MiniMax's own direct curl response parses fine; never reached |

## Hypotheses still live

1. **`apiPreconnect` or a similar prefetch** opens the TCP socket during startup (explaining the ESTABLISHED connection) and then some downstream `await` loops on an unrelated unresolved promise.
2. **`loadAllPluginsCacheOnly` re-entrancy** — `main.tsx:282` fires `void loadAllPluginsCacheOnly().then(...)`; a `.then()` callback may throw and get swallowed by `.catch(err => logError(err))` while the main path awaits the cached promise.
3. **Managed settings / mDNS probe** — `waitForRemoteManagedSettingsToLoad` or the mTLS configure may be blocked on a kernel call.
4. **React tree bootstrap in non-interactive mode** — even in `-p`, something renders and awaits. Some component's `useEffect` may never finish.

## Next session — surgical plan (15-minute fix)

1. Add 8 numbered `logForDebugging('[STARTUP] checkpoint N at main.tsx:LINE')` at every major `await` in `main.tsx` between lines 2389 and 3200 (every ~100 lines).
2. Rebuild and re-run the bare-mode pipe reproduction. First missing checkpoint number pinpoints the hang to a 100-line block.
3. Read that block; locate the offending `await` or `void`; add a timeout or error propagation.
4. Add a regression test in `tests/` that spawns pipe mode with `timeout 5` and expects completion.

Checkpoints to plant (reading main.tsx bottom-up from the "Found N plugins" side up to `[STARTUP] MCP configs resolved`):

```
  [STARTUP] before isNonInteractiveSession branch
  [STARTUP] after hooksPromise construction
  [STARTUP] after mcpPromise construction
  [STARTUP] after logSessionTelemetry
  [STARTUP] before runHeadless/renderInteractive dispatch
  [STARTUP] after apiPreconnect decision
  [STARTUP] after logPluginsEnabledForSession
  [STARTUP] before main async action handler returns
```

## Environment config already applied (keep for next session)

`~/.claude/plugins/**/hooks.json` UserPromptSubmit arrays emptied for: pua-skills (cache + marketplace), evermem (cache + marketplace), vercel, hookify. Backups: `hooks.json.bak-20260417-*`.

`~/.claude/projects/-Users-0xvox-...-dreamy-mccarthy-a22317/.claude/settings.json` has `plugins.vercel@claude-plugins-official: false`.

Source code has debug instrumentation in `src/utils/handlePromptSubmit.ts` (L528 `[executeUserInput] processUserInput done ...`) and `src/services/api/claude.ts` (L1973 `[api] request SENT`, L1997 `[api] response HEADERS`, L2105 `[api] FIRST CHUNK`). None of these fire in current repros — confirming the hang is before API client invocation.

## Relevant files

| File | Role |
|---|---|
| `src/main.tsx` | The 50-line hang window between L2389 and L3200 |
| `src/cli/print.ts` | Pipe-mode entry (`runHeadless`) — downstream of the hang |
| `src/utils/handlePromptSubmit.ts` | REPL-mode entry — downstream of the hang |
| `src/services/api/claude.ts` | API client — downstream of the hang |
| `src/utils/plugins/pluginLoader.ts:3200` | Emits the `Found N plugins` log that is the last visible breadcrumb |
| `src/utils/attachments.ts:752-761` | `CLAUDE_CODE_DISABLE_ATTACHMENTS` gate (works; skills skipped in repros) |
| `src/services/mcp/claudeai.ts:42` | `ENABLE_CLAUDEAI_MCP_SERVERS` gate (works) |
| `.planning/POST-MORTEM-REPL-HANG-2026-04-16.md` (main repo only) | Prior 4-hour investigation; identifies a different root cause (vibe-island-bridge hook, already deleted) |

## Reproducing in one command

```bash
: > /tmp/ccr-live.log
CLAUDE_CODE_DISABLE_ATTACHMENTS=1 \
ENABLE_CLAUDEAI_MCP_SERVERS=0 \
CLAUDE_CODE_SIMPLE=1 \
bun run dist/cli.js -p \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --debug-file /tmp/ccr-live.log \
  --output-format text <<< "say OK"
# Hangs for 2–3 minutes. Ctrl+C. tail /tmp/ccr-live.log — last line is
# "Found N plugins (M enabled, K disabled)".
```

## Scope guardrails for the collaborator (unchanged)

- Do **not** touch model capability code (`src/utils/model/capabilities.ts`, `defineModel.ts`, `configs.ts`) — parity tests protect it.
- Do **not** add runtime dependencies.
- Do **not** reintroduce Node-only APIs.
- **Do** instrument every async boundary between main.tsx:2389 and pluginLoader.ts:3200.
- **Do** add a regression test asserting pipe mode completes in ≤ 10s on an empty plugin set.
