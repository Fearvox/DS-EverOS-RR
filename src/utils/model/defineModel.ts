/**
 * defineModel() — ergonomic DSL for registering a new Claude model.
 *
 * One call site produces both the ModelConfig (firstParty + provider strings)
 * and the ModelCapabilities entry. Future model launches become: define once
 * here, register into ALL_MODEL_CONFIGS + CAPABILITY_REGISTRY, done — instead
 * of walking 10+ files.
 *
 * This helper is side-effect-free: it just builds the two objects. The caller
 * is still responsible for adding them to the registry exports (by design,
 * so registration remains explicit and greppable).
 */

import type { ModelConfig } from './configs.js'
import type { ModelCapabilities } from './capabilities.js'

type CapabilityFlags = Omit<
  ModelCapabilities,
  'marketingName' | 'knowledgeCutoff' | 'frontier'
>

export type DefineModelInput = {
  /** First-party canonical ID, e.g. 'claude-opus-4-7' */
  id: string
  /** Provider-specific IDs */
  bedrock: string
  vertex: string
  foundry: string
  /** Marketing name for the /model picker + attribution, e.g. 'Opus 4.7' */
  marketingName: string
  /** Display-only knowledge cutoff string, or null if not published */
  knowledgeCutoff?: string | null
  /** Capability flags — any omitted flag defaults to false */
  capabilities?: Partial<CapabilityFlags>
  /** True for the single current frontier model; enforced as singleton by test */
  frontier?: boolean
}

const CAPABILITY_DEFAULTS: CapabilityFlags = {
  effort: false,
  maxEffort: false,
  xhighEffort: false,
  adaptiveThinking: false,
  structuredOutputs: false,
  autoMode: false,
  supports1m: false,
}

export type DefinedModel = {
  config: ModelConfig
  capabilities: ModelCapabilities
}

export function defineModel(input: DefineModelInput): DefinedModel {
  return {
    config: {
      firstParty: input.id,
      bedrock: input.bedrock,
      vertex: input.vertex,
      foundry: input.foundry,
    },
    capabilities: {
      ...CAPABILITY_DEFAULTS,
      ...(input.capabilities ?? {}),
      marketingName: input.marketingName,
      knowledgeCutoff: input.knowledgeCutoff ?? null,
      frontier: input.frontier ?? false,
    },
  }
}
