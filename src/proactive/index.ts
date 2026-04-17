// Proactive mode state management — minimal implementation for KAIROS
let _active = false
let _paused = false
let _source: string | undefined

export function isProactiveActive(): boolean {
  return _active && !_paused
}

export function activateProactive(source?: string): void {
  _active = true
  _paused = false
  _source = source
}

export function isProactivePaused(): boolean {
  return _paused
}

export function deactivateProactive(): void {
  _active = false
  _paused = false
  _source = undefined
}

export function pauseProactive(): void {
  _paused = true
}

export function resumeProactive(): void {
  _paused = false
}

export function getProactiveSource(): string | undefined {
  return _source
}

// --- useSyncExternalStore compatibility ---
// REPL.tsx and PromptInputFooterLeftSide.tsx call these via optional chaining
// with fallback, but export them for completeness.
type Listener = () => void
const _listeners = new Set<Listener>()

function _notify(): void {
  for (const fn of _listeners) fn()
}

export function subscribeToProactiveChanges(listener: Listener): () => void {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

// Next scheduled tick timestamp (null = no scheduled tick)
let _nextTickAt: number | null = null

export function getNextTickAt(): number | null {
  return _nextTickAt
}

export function setNextTickAt(ts: number | null): void {
  _nextTickAt = ts
  _notify()
}
