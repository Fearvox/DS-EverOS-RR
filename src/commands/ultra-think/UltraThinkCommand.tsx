import { c as _c } from 'react/compiler-runtime'
import * as React from 'react'
import type { CommandResultDisplay } from '../../types/command.js'
import { Select } from '../../components/CustomSelect/select.js'
import { Box, Text } from '../../ink.js'

// ── Engine definitions ────────────────────────────────────────────────────────

type Engine = 'p9' | 'codex' | 'gsd'

interface EngineOption {
  engine: Engine
  label: string
  tagline: string
  description: string
  emoji: string
}

const ENGINES: EngineOption[] = [
  {
    engine: 'p9',
    label: 'P9 Tech Lead',
    tagline: '多P7并行子代理团队',
    description:
      'P9战略拆解 → Task Prompt定义 → P8团队管理 → 验收闭环。适用于跨模块功能开发、接口变更、性能优化、技术预研等需要"想清楚再做"的大型任务。',
    emoji: '🧠',
  },
  {
    engine: 'codex',
    label: 'Codex Rescue',
    tagline: '对抗性漏洞扫描',
    description:
      'Codex伴侣进行深度调查、根本原因诊断、或对抗性审查。Opus 4.6 max 推理，针对复杂bug、多模型对比、漏洞挖掘场景。',
    emoji: '🔍',
  },
  {
    engine: 'gsd',
    label: 'GSD Plan-Phase',
    tagline: '结构化分阶段执行',
    description:
      'GSD工作流：研究 → 计划 → 执行 → 验证闭环。产生 RESEARCH.md + PLAN.md，先验证据驱动，覆盖完整生命周期。',
    emoji: '📋',
  },
]

// ── Prompts sent to model after selection ─────────────────────────────────────

function buildPrompt(engine: Engine, task: string): string {
  switch (engine) {
    case 'gsd':
      return `Use /gsd-plan-phase to plan: ${task || 'the current project task'}`
    case 'codex':
      return `Use /codex:rescue to investigate: ${task || 'the current issue'}`
    case 'p9':
      return `Use tech-lead-p9 to orchestrate: ${task || 'the current task'}`
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

function UltraThinkPicker({
  onSelect,
}: {
  onSelect: (engine: Engine) => void
}) {
  const $ = _c(2)

  let t1: React.ReactNode
  if ($[0] === Symbol.for('react.memo_cache_sentinel')) {
    t1 = (
      <Box flexDirection="column" gap={1}>
        <Text bold={true}>
          ultra-think — 选择深度推理引擎
        </Text>
        <Text dimColor={true}>
          按 Enter 选中 · ↑↓ 切换选项
        </Text>
      </Box>
    )
    ;$[0] = t1
  } else {
    t1 = $[0]
  }

  let t2: React.ReactNode
  if ($[1] === Symbol.for('react.memo_cache_sentinel')) {
    t2 = (
      <Box flexDirection="column" marginTop={1}>
        <Select
          options={ENGINES.map(e => ({
            value: e.engine,
            label: `${e.emoji}  ${e.label}  —  ${e.tagline}`,
            description: e.description,
          }))}
          onChange={val => onSelect(val as Engine)}
        />
      </Box>
    )
    ;$[1] = t2
  } else {
    t2 = $[1]
  }

  return (
    <Box flexDirection="column">
      {t1}
      {t2}
    </Box>
  )
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function call(
  onDone: (
    result?: string,
    options?: {
      display?: CommandResultDisplay
      shouldQuery?: boolean
      metaMessages?: string[]
    },
  ) => void,
  _context: unknown,
  args: string,
): Promise<React.ReactNode> {
  return (
    <UltraThinkPicker
      onSelect={engine => {
        const prompt = buildPrompt(engine, args.trim())
        onDone(prompt, { display: 'user', shouldQuery: true })
      }}
    />
  )
}
