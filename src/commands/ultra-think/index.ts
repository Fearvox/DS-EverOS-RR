import type { Command } from '../../commands.js'

const ultraThink: Command = {
  type: 'local-jsx',
  name: 'ultra-think',
  aliases: ['ultra-think', 'uthink'],
  description:
    'Choose a deep-reasoning engine: P9 Tech Lead (multi-P7), Codex Rescue (adversarial scan), or GSD Plan (structured phase plan)',
  argumentHint: '[task description]',
  userInvocable: true,
  isHidden: false,
  load: () => import('./UltraThinkCommand.js'),
}

export default ultraThink
