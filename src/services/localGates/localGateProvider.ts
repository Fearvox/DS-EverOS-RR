/**
 * Local Gate Provider - Decoupling Layer for tengu_* Feature Gates
 *
 * Intercepts all tengu_* gates and routes them exclusively to local
 * ~/.claude/feature-flags.json, bypassing remote cache (cachedGrowthBookFeatures).
 *
 * This ensures tengu_* gates remain available even when GrowthBook init fails,
 * and prevents stale values from .claude.json from being used.
 */

import { getLocalFlagOverrides } from '../analytics/growthbook.js'
import { feature } from '../../utils/featureFlag.js'

/**
 * Check if a gate name is a local gate (tengu_* prefix).
 * Local gates are routed exclusively to local feature-flags.json.
 */
export function isLocalGate(gateName: string): boolean {
  return gateName.startsWith('tengu_')
}

/**
 * Get a local gate value from ~/.claude/feature-flags.json.
 * Returns the value if the gate is a local gate AND exists in the local file.
 * Returns null if:
 *   - The gate is not a local gate (not tengu_*)
 *   - The gate is not present in feature-flags.json
 *   - The feature-flags.json file does not exist or cannot be parsed
 */
export function getLocalGateValue(gateName: string): unknown {
  if (!isLocalGate(gateName)) {
    return null
  }

  const localOverrides = getLocalFlagOverrides()
  if (!localOverrides || !(gateName in localOverrides)) {
    return null
  }

  return localOverrides[gateName]
}

/**
 * Result of resolving a gate, includes the source for logging.
 */
export interface GateResolution {
  source: 'local' | 'remote-cache'
  value: boolean
}

/**
 * Resolve a gate with local-first priority.
 * For tengu_* gates: always reads from local feature-flags.json.
 * For non-tengu_* gates: returns null (not handled by local provider).
 *
 * Logs every gate check with source for debugging.
 */
export function resolveGate(gateName: string): GateResolution | null {
  if (!isLocalGate(gateName)) {
    return null
  }

  const value = getLocalGateValue(gateName)
  if (value === null) {
    return null
  }

  // Log gate resolution with source
  // Note: feature() logging is handled by the featureFlag module
  if (feature('DEBUG_GATE_RESOLUTION')) {
    console.log(`[GateResolution] ${gateName} = ${value} (source: local)`)
  }

  return {
    source: 'local',
    value: Boolean(value),
  }
}
