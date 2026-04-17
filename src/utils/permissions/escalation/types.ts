/**
 * Dynamic Permission Escalation types (Phase 08).
 *
 * Key design decisions from cross-AI review:
 * - contextId (not PID) as scope key -- in-process subagents share PID (review HIGH #1)
 * - 'escalation' as dedicated PermissionRuleSource -- 'session' carries other rules (review HIGH #2)
 * - toolName + ruleContent granularity -- matches existing permission model (review MEDIUM #6)
 */

/**
 * An active escalation grant -- user approved temporary elevated permission.
 * Keyed by contextId + toolName + optional ruleContent.
 *
 * contextId is a logical session/agent identifier (NOT process.pid).
 * Only the main session context ID can hold escalation grants.
 * Forked agents get new agentIds that won't match.
 */
export type EscalationGrant = {
  contextId: string              // Logical context identifier (main session agentId)
  toolName: string               // Which tool is escalated (e.g., 'Bash', 'FileEdit')
  ruleContent?: string           // Optional content pattern (e.g., 'npm publish:*')
  grantedAt: number              // Date.now() at grant time for debugging/logging
  reason: string                 // Why the agent requested this escalation
}

/**
 * A structured escalation request from the agent to the user.
 * Reuses existing permission prompt flow (review HIGH #4).
 */
export type EscalationRequest = {
  toolName: string               // Which tool needs escalation
  ruleContent?: string           // Optional content pattern for granularity
  reason: string                 // Agent's justification for the escalation
  riskContext?: string           // Optional risk info from deliberation (CONFIRM_ONCE tier)
}

/**
 * Record of a user-denied escalation request.
 * Used to prevent re-prompting within the same session.
 */
export type EscalationDenial = {
  toolName: string
  ruleContent?: string
  deniedAt: number
}
