/**
 * EscalationStore -- context-ID-scoped escalation state manager (Phase 08).
 *
 * Follows the deliberationMemory.ts and denialTracking.ts patterns:
 * module-level Map, no disk persistence, process-scoped only (PERM-05).
 *
 * Key design decisions from cross-AI review:
 * - contextId (not PID) as scope key (review HIGH #1)
 *   In-process subagents share a PID; contextId provides logical isolation.
 * - Single source of truth (review MEDIUM #5)
 *   This store is the SOLE authority for escalation state.
 * - Tool + ruleContent granularity with wildcard fallback (review MEDIUM #6)
 */

import type { EscalationGrant, EscalationDenial } from './types.js'

// ── Module-level state -- dies with the process (PERM-05) ────

const activeGrants = new Map<string, EscalationGrant>()
const deniedRequests = new Map<string, EscalationDenial>()
let mainSessionContextId: string | null = null

// ── Key generation ───────────────────────────────────────────

/**
 * Generate a composite key for grant lookup.
 * Format: `${contextId}:${toolName}:${ruleContent ?? '*'}`
 */
export function grantKey(
  contextId: string,
  toolName: string,
  ruleContent?: string,
): string {
  return `${contextId}:${toolName}:${ruleContent ?? '*'}`
}

// ── Context registration ─────────────────────────────────────

/**
 * Register the main session context ID.
 * Called once at session startup (e.g., in init.ts or REPL mount).
 * Only this context ID can hold escalation grants.
 * Forked agents get new agentIds that won't match.
 */
export function registerMainSessionContext(contextId: string): void {
  mainSessionContextId = contextId
}

// ── Grant management ─────────────────────────────────────────

/**
 * Store an escalation grant.
 * Validates that the grant's contextId matches the registered main session context.
 * Throws if no context is registered or if there's a mismatch.
 */
export function grantEscalation(grant: EscalationGrant): void {
  if (mainSessionContextId === null) {
    throw new Error('No main session context registered')
  }
  if (grant.contextId !== mainSessionContextId) {
    throw new Error(
      `Escalation context ID mismatch: grant.contextId=${grant.contextId}, mainSessionContextId=${mainSessionContextId}`,
    )
  }
  const key = grantKey(grant.contextId, grant.toolName, grant.ruleContent)
  activeGrants.set(key, grant)
}

/**
 * Check if an escalation exists for the given context + tool + optional ruleContent.
 *
 * Lookup order:
 * 1. Exact key: contextId:toolName:ruleContent
 * 2. Wildcard fallback: contextId:toolName:* (if ruleContent was provided)
 *
 * A forked agent passing its own agentId as contextId will always get false
 * because grants are only stored under mainSessionContextId.
 */
export function hasEscalation(
  contextId: string,
  toolName: string,
  ruleContent?: string,
): boolean {
  // Exact match
  if (activeGrants.has(grantKey(contextId, toolName, ruleContent))) {
    return true
  }
  // Wildcard fallback: if ruleContent was specified, check the '*' key
  if (ruleContent !== undefined) {
    return activeGrants.has(grantKey(contextId, toolName))
  }
  return false
}

/**
 * Get the escalation grant for a specific tool, or undefined if not found.
 * Same lookup logic as hasEscalation but returns the grant object.
 */
export function getEscalationForTool(
  contextId: string,
  toolName: string,
  ruleContent?: string,
): EscalationGrant | undefined {
  // Exact match
  const exactKey = grantKey(contextId, toolName, ruleContent)
  const exact = activeGrants.get(exactKey)
  if (exact) return exact
  // Wildcard fallback
  if (ruleContent !== undefined) {
    const wildcardKey = grantKey(contextId, toolName)
    return activeGrants.get(wildcardKey)
  }
  return undefined
}

/**
 * Get all active grants for a given contextId.
 * Returns a filtered view containing only entries matching the contextId prefix.
 */
export function getActiveGrants(
  contextId: string,
): ReadonlyMap<string, EscalationGrant> {
  const prefix = `${contextId}:`
  const filtered = new Map<string, EscalationGrant>()
  for (const [key, grant] of activeGrants) {
    if (key.startsWith(prefix)) {
      filtered.set(key, grant)
    }
  }
  return filtered
}

/**
 * Revoke all escalation grants and clear denied request tracking.
 * Called at session teardown or explicit user request.
 */
export function revokeAllEscalations(): void {
  activeGrants.clear()
  deniedRequests.clear()
}

// ── Denied request tracking ──────────────────────────────────

/**
 * Record a user-denied escalation request.
 * Prevents re-prompting for the same tool within the session.
 */
export function recordDeniedEscalation(
  toolName: string,
  ruleContent?: string,
): void {
  const key = `${toolName}:${ruleContent ?? '*'}`
  deniedRequests.set(key, {
    toolName,
    ruleContent,
    deniedAt: Date.now(),
  })
}

/**
 * Check if an escalation request was previously denied.
 */
export function wasEscalationDenied(
  toolName: string,
  ruleContent?: string,
): boolean {
  return deniedRequests.has(`${toolName}:${ruleContent ?? '*'}`)
}

// ── Test utilities ───────────────────────────────────────────

/**
 * Reset all module state for test isolation.
 * Clears grants, denied requests, and registered context.
 */
export function _resetForTesting(): void {
  activeGrants.clear()
  deniedRequests.clear()
  mainSessionContextId = null
}
