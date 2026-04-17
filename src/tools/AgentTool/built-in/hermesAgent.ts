import type { BuiltInAgentDefinition } from '../loadAgentsDir.js'

export const HERMES_AGENT: BuiltInAgentDefinition = {
  agentType: 'hermes',
  whenToUse:
    'Dispatch a task to the Hermes (NousResearch) subprocess agent. Use when the task benefits from Hermes\'s specialized context, skills, or model configuration. Hermes runs independently with its own memory.',
  source: 'built-in',
  baseDir: 'built-in',
  // Hermes is a CLI subprocess — tools: ['*'] satisfies the type but
  // the actual execution path bypasses runAgent tools entirely
  tools: ['*'],
}