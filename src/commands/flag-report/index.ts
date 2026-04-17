/**
 * Flag Report command - runs CCR diagnostic report on feature flags and gate health.
 */
import type { Command } from '../../commands.js'

const flagReport = {
  type: 'local',
  name: 'flag-report',
  description: 'Run CCR diagnostic report on feature flags and gate health',
  supportsNonInteractive: true,
  load: () => import('./flagReport.js'),
} satisfies Command

export default flagReport
