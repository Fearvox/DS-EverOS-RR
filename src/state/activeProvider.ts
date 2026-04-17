/**
 * Module-level singleton for the active provider name.
 * Read by query paths that need provider info before AppState is available
 * (e.g., API call setup where React context isn't accessible).
 *
 * Written by /provider command via setActiveProvider().
 * Read by queryModel() in claude.ts via getActiveProvider().
 */

let _activeProvider = 'anthropic'

export function getActiveProvider(): string {
  return _activeProvider
}

export function setActiveProvider(name: string): void {
  _activeProvider = name
}
