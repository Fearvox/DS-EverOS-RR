// @ts-nocheck — integration test, dynamic dispatch through getCanonicalName
import { describe, it, expect } from 'bun:test'
import { CANONICAL_MODEL_IDS } from '../src/utils/model/configs'
import {
  CAPABILITY_REGISTRY,
  getCapability,
} from '../src/utils/model/capabilities'
import { getCanonicalName } from '../src/utils/model/model'

describe('CAPABILITY_REGISTRY — Task 1 skeleton', () => {
  it('has an entry for every canonical model ID after resolution', () => {
    for (const id of CANONICAL_MODEL_IDS) {
      const shortName = getCanonicalName(id)
      expect(CAPABILITY_REGISTRY[shortName]).toBeDefined()
    }
  })

  it('Opus 4.7 supports xhighEffort (frontier-only)', () => {
    expect(getCapability('claude-opus-4-7', 'xhighEffort')).toBe(true)
    expect(getCapability('claude-opus-4-6', 'xhighEffort')).toBe(false)
  })

  it('Opus 4.6 and 4.7 both support maxEffort', () => {
    expect(getCapability('claude-opus-4-6', 'maxEffort')).toBe(true)
    expect(getCapability('claude-opus-4-7', 'maxEffort')).toBe(true)
    expect(getCapability('claude-sonnet-4-6', 'maxEffort')).toBe(false)
  })

  it('1M context flag matches context.ts legacy', () => {
    expect(getCapability('claude-opus-4-7', 'supports1m')).toBe(true)
    expect(getCapability('claude-opus-4-6', 'supports1m')).toBe(true)
    expect(getCapability('claude-sonnet-4-5-20250929', 'supports1m')).toBe(true)
    expect(getCapability('claude-3-7-sonnet-20250219', 'supports1m')).toBe(false)
  })

  it('knowledge cutoff returns registry value', () => {
    expect(getCapability('claude-opus-4-7', 'knowledgeCutoff')).toBe('January 2026')
    expect(getCapability('claude-opus-4-6', 'knowledgeCutoff')).toBe('May 2025')
    expect(getCapability('claude-sonnet-4-6', 'knowledgeCutoff')).toBe('August 2025')
  })

  it('unknown model returns defaults (false / null)', () => {
    expect(getCapability('gpt-5-turbo', 'effort')).toBe(false)
    expect(getCapability('gpt-5-turbo', 'knowledgeCutoff')).toBe(null)
  })
})

describe('effort.ts registry migration parity — Task 2', () => {
  const {
    modelSupportsEffort,
    modelSupportsMaxEffort,
    modelSupportsXHighEffort,
  } = require('../src/utils/effort')

  const cases: Array<[string, boolean, boolean, boolean]> = [
    ['claude-opus-4-7', true, true, true],
    ['claude-opus-4-6', true, true, false],
    ['claude-sonnet-4-6', true, false, false],
    ['claude-haiku-4-5-20251001', false, false, false],
    ['claude-3-7-sonnet-20250219', false, false, false],
  ]

  for (const [model, eff, max, xh] of cases) {
    it(`${model} → effort=${eff}, max=${max}, xh=${xh}`, () => {
      expect(modelSupportsEffort(model)).toBe(eff)
      expect(modelSupportsMaxEffort(model)).toBe(max)
      expect(modelSupportsXHighEffort(model)).toBe(xh)
    })
  }
})

describe('registry invariants — Task 6', () => {
  it('exactly one entry has frontier=true', () => {
    const frontiers = Object.entries(CAPABILITY_REGISTRY)
      .filter(([, caps]) => caps.frontier)
      .map(([id]) => id)
    expect(frontiers).toHaveLength(1)
    expect(frontiers[0]).toBe('claude-opus-4-7')
  })

  it('xhighEffort implies maxEffort', () => {
    for (const [id, caps] of Object.entries(CAPABILITY_REGISTRY)) {
      if (caps.xhighEffort) {
        expect(caps.maxEffort).toBe(true)
      }
    }
  })

  it('adaptiveThinking implies effort', () => {
    for (const [id, caps] of Object.entries(CAPABILITY_REGISTRY)) {
      if (caps.adaptiveThinking) {
        expect(caps.effort).toBe(true)
      }
    }
  })
})

describe('defineModel DSL — Task 7', () => {
  const { defineModel } = require('../src/utils/model/defineModel')

  it('builds config + capabilities with defaults filled in', () => {
    const m = defineModel({
      id: 'claude-test-0',
      bedrock: 'us.anthropic.claude-test-0-v1',
      vertex: 'claude-test-0',
      foundry: 'claude-test-0',
      marketingName: 'Test 0',
      capabilities: { effort: true, supports1m: false },
    })
    expect(m.config.firstParty).toBe('claude-test-0')
    expect(m.config.bedrock).toBe('us.anthropic.claude-test-0-v1')
    expect(m.capabilities.effort).toBe(true)
    expect(m.capabilities.maxEffort).toBe(false)
    expect(m.capabilities.marketingName).toBe('Test 0')
    expect(m.capabilities.frontier).toBe(false)
    expect(m.capabilities.knowledgeCutoff).toBe(null)
  })

  it('accepts knowledgeCutoff and frontier overrides', () => {
    const m = defineModel({
      id: 'claude-future-0',
      bedrock: 'us.anthropic.claude-future-0-v1',
      vertex: 'claude-future-0',
      foundry: 'claude-future-0',
      marketingName: 'Future 0',
      knowledgeCutoff: 'March 2027',
      frontier: true,
      capabilities: {
        effort: true,
        maxEffort: true,
        xhighEffort: true,
        adaptiveThinking: true,
        structuredOutputs: true,
        autoMode: true,
        supports1m: true,
      },
    })
    expect(m.capabilities.frontier).toBe(true)
    expect(m.capabilities.knowledgeCutoff).toBe('March 2027')
    expect(m.capabilities.xhighEffort).toBe(true)
  })
})

describe('modelCost rename — Task 5', () => {
  const {
    COST_OPUS_FRONTIER,
    COST_TIER_5_25,
  } = require('../src/utils/modelCost')

  it('exports COST_OPUS_FRONTIER with 5/25 per-MTok pricing', () => {
    expect(COST_OPUS_FRONTIER).toBeDefined()
    expect(COST_OPUS_FRONTIER.inputTokens).toBe(5)
    expect(COST_OPUS_FRONTIER.outputTokens).toBe(25)
  })

  it('keeps COST_TIER_5_25 as deprecated alias pointing to same object', () => {
    expect(COST_TIER_5_25).toBe(COST_OPUS_FRONTIER)
  })
})

describe('prompts.ts getKnowledgeCutoff parity — Task 4', () => {
  const { _getKnowledgeCutoffForTest: cutoff } = require('../src/constants/prompts')

  it('returns registry value for known canonicals', () => {
    expect(cutoff('claude-opus-4-7')).toBe('January 2026')
    expect(cutoff('claude-opus-4-6')).toBe('May 2025')
    expect(cutoff('claude-sonnet-4-6')).toBe('August 2025')
    expect(cutoff('claude-haiku-4-5-20251001')).toBe('February 2025')
  })

  it('preserves legacy "January 2025" for claude-opus-4 / sonnet-4 family', () => {
    expect(cutoff('claude-opus-4-20250514')).toBe('January 2025')
    expect(cutoff('claude-sonnet-4-20250514')).toBe('January 2025')
  })

  it('returns null for unknown model (legacy behavior)', () => {
    expect(cutoff('gpt-5-turbo')).toBe(null)
  })
})

describe('thinking/betas/context registry parity — Task 3', () => {
  const { modelSupportsAdaptiveThinking } = require('../src/utils/thinking')
  const {
    modelSupportsStructuredOutputs,
  } = require('../src/utils/betas')
  const { modelSupports1M } = require('../src/utils/context')

  it('adaptive thinking: Opus 4.6/4.7 and Sonnet 4.6 only', () => {
    expect(modelSupportsAdaptiveThinking('claude-opus-4-7')).toBe(true)
    expect(modelSupportsAdaptiveThinking('claude-opus-4-6')).toBe(true)
    expect(modelSupportsAdaptiveThinking('claude-sonnet-4-6')).toBe(true)
    expect(modelSupportsAdaptiveThinking('claude-opus-4-5-20251101')).toBe(false)
  })

  it('structured outputs: 4.1+ and Haiku 4.5 (1P-only)', () => {
    expect(modelSupportsStructuredOutputs('claude-opus-4-7')).toBe(true)
    expect(modelSupportsStructuredOutputs('claude-opus-4-1-20250805')).toBe(true)
    expect(modelSupportsStructuredOutputs('claude-haiku-4-5-20251001')).toBe(true)
    expect(modelSupportsStructuredOutputs('claude-3-5-sonnet-20241022')).toBe(false)
  })

  it('1M context: Sonnet 4+ and Opus 4-6/4-7 only', () => {
    expect(modelSupports1M('claude-opus-4-7')).toBe(true)
    expect(modelSupports1M('claude-opus-4-6')).toBe(true)
    expect(modelSupports1M('claude-sonnet-4-5-20250929')).toBe(true)
    expect(modelSupports1M('claude-opus-4-5-20251101')).toBe(false)
  })
})
