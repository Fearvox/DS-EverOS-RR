/**
 * Single source of truth for per-model capability flags + metadata.
 *
 * Replaces the 10+ `canonical.includes('opus-4-6')` pattern-match sites
 * scattered across effort.ts / thinking.ts / betas.ts / context.ts /
 * prompts.ts. Adding a new model = one entry here (plus configs.ts
 * CLAUDE_*_CONFIG for the provider strings).
 *
 * Keys are ShortName (date-stripped canonical form returned by
 * `firstPartyNameToCanonical` / `getCanonicalName`), NOT firstParty IDs —
 * so both `claude-haiku-4-5-20251001` and `claude-haiku-4-5` resolve to
 * the same entry via `getCanonicalName`.
 */

import type { ModelShortName } from './model.js'

export type ModelCapabilities = {
  /** supports `effort` parameter (low/medium/high) */
  effort: boolean
  /** supports `max` effort tier */
  maxEffort: boolean
  /** supports `xhigh` effort tier (Opus 4.7 only at introduction) */
  xhighEffort: boolean
  /** supports adaptive thinking (4.6+) */
  adaptiveThinking: boolean
  /** supports structured outputs beta (caller still checks provider) */
  structuredOutputs: boolean
  /** supports PI-probe auto mode (external allowlist) */
  autoMode: boolean
  /** 1M context window available (with `[1m]` suffix) */
  supports1m: boolean
  /** knowledge cutoff display string (e.g. "January 2026") or null */
  knowledgeCutoff: string | null
  /** marketing name for /model picker + attribution */
  marketingName: string
  /** the single frontier model at any point — test asserts exactly one */
  frontier: boolean
}

const DEFAULT_CAPS: Omit<ModelCapabilities, 'marketingName' | 'knowledgeCutoff' | 'frontier'> = {
  effort: false,
  maxEffort: false,
  xhighEffort: false,
  adaptiveThinking: false,
  structuredOutputs: false,
  autoMode: false,
  supports1m: false,
}

/**
 * Registry keyed by ShortName (date-stripped canonical form).
 */
export const CAPABILITY_REGISTRY: Record<string, ModelCapabilities> = {
  'claude-3-5-haiku': {
    ...DEFAULT_CAPS,
    knowledgeCutoff: 'July 2024',
    marketingName: 'Haiku 3.5',
    frontier: false,
  },
  'claude-haiku-4-5': {
    ...DEFAULT_CAPS,
    structuredOutputs: true,
    knowledgeCutoff: 'February 2025',
    marketingName: 'Haiku 4.5',
    frontier: false,
  },
  'claude-3-5-sonnet': {
    ...DEFAULT_CAPS,
    knowledgeCutoff: 'April 2024',
    marketingName: 'Claude 3.5 Sonnet',
    frontier: false,
  },
  'claude-3-7-sonnet': {
    ...DEFAULT_CAPS,
    knowledgeCutoff: 'November 2024',
    marketingName: 'Claude 3.7 Sonnet',
    frontier: false,
  },
  'claude-sonnet-4': {
    ...DEFAULT_CAPS,
    supports1m: true,
    // Legacy prompts.ts returned 'January 2025' for claude-sonnet-4 — preserved
    // for parity; a follow-up should verify against Anthropic model card.
    knowledgeCutoff: 'January 2025',
    marketingName: 'Sonnet 4',
    frontier: false,
  },
  'claude-sonnet-4-5': {
    ...DEFAULT_CAPS,
    structuredOutputs: true,
    supports1m: true,
    knowledgeCutoff: 'July 2025',
    marketingName: 'Sonnet 4.5',
    frontier: false,
  },
  'claude-sonnet-4-6': {
    ...DEFAULT_CAPS,
    effort: true,
    adaptiveThinking: true,
    structuredOutputs: true,
    autoMode: true,
    supports1m: true,
    knowledgeCutoff: 'August 2025',
    marketingName: 'Sonnet 4.6',
    frontier: false,
  },
  'claude-opus-4': {
    ...DEFAULT_CAPS,
    // Legacy prompts.ts returned 'January 2025' for claude-opus-4 — preserved.
    knowledgeCutoff: 'January 2025',
    marketingName: 'Opus 4',
    frontier: false,
  },
  'claude-opus-4-1': {
    ...DEFAULT_CAPS,
    structuredOutputs: true,
    // Legacy had no explicit 4-1 branch; fell through to 'January 2025' for
    // 'claude-opus-4' substring. Preserved for parity.
    knowledgeCutoff: 'January 2025',
    marketingName: 'Opus 4.1',
    frontier: false,
  },
  'claude-opus-4-5': {
    ...DEFAULT_CAPS,
    structuredOutputs: true,
    knowledgeCutoff: 'May 2025',
    marketingName: 'Opus 4.5',
    frontier: false,
  },
  'claude-opus-4-6': {
    ...DEFAULT_CAPS,
    effort: true,
    maxEffort: true,
    adaptiveThinking: true,
    structuredOutputs: true,
    autoMode: true,
    supports1m: true,
    knowledgeCutoff: 'May 2025',
    marketingName: 'Opus 4.6',
    frontier: false,
  },
  'claude-opus-4-7': {
    ...DEFAULT_CAPS,
    effort: true,
    maxEffort: true,
    xhighEffort: true,
    adaptiveThinking: true,
    structuredOutputs: true,
    autoMode: true,
    supports1m: true,
    knowledgeCutoff: 'January 2026',
    marketingName: 'Opus 4.7',
    frontier: true,
  },
}

function defaultFor<K extends keyof ModelCapabilities>(
  key: K,
): ModelCapabilities[K] {
  if (key === 'knowledgeCutoff') return null as ModelCapabilities[K]
  if (key === 'marketingName') return '' as ModelCapabilities[K]
  return false as ModelCapabilities[K]
}

/**
 * Resolve a model string (any form: firstParty, provider-prefixed, with
 * `[1m]` suffix, with date suffix) to ShortName then look up a capability.
 *
 * Returns the capability default (false / null / '') for unknown models,
 * matching the legacy pattern-match "unknown → false" contract.
 *
 * Lazy-requires `./model.js` to avoid a module-load cycle with configs.ts.
 */
export function getCapability<K extends keyof ModelCapabilities>(
  model: string,
  key: K,
): ModelCapabilities[K] {
  const { getCanonicalName } = require('./model.js') as typeof import('./model.js')
  const shortName = getCanonicalName(model) as ModelShortName
  const entry = CAPABILITY_REGISTRY[shortName]
  if (!entry) {
    return defaultFor(key)
  }
  return entry[key]
}
