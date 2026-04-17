import { FlagHealthResult } from './flagHealth.js'

export interface ReportOutput {
  json: FlagHealthResult[]
  terminal: string
}

/**
 * Generate a health report from scan results.
 * @param results - Array of FlagHealthResult from scanAllFlags()
 * @returns Object containing JSON output and formatted terminal table
 */
export function generateReport(results: FlagHealthResult[]): ReportOutput {
  // JSON output - just return the results array (already in correct format)
  const json = results

  // Terminal table output
  const terminal = formatTerminalTable(results)

  return { json, terminal }
}

/**
 * Format results as a terminal table
 */
function formatTerminalTable(results: FlagHealthResult[]): string {
  const lines: string[] = []
  
  // Header
  const header = '  FLAG                          STATUS          TIME (ms)  DEPENDS ON'
  const separator = '  ' + '-'.repeat(70)
  
  lines.push('')
  lines.push('  Feature Flag Health Report')
  lines.push(`  Generated at: ${new Date().toISOString()}`)
  lines.push('')
  lines.push(header)
  lines.push(separator)

  // Count by status
  const statusCounts: Record<string, number> = {
    operational: 0,
    loadable: 0,
    broken: 0,
    'missing-dep': 0,
  }

  // Rows
  for (const result of results) {
    statusCounts[result.status] = (statusCounts[result.status] || 0) + 1
    
    const flag = result.flag.padEnd(30).slice(0, 30)
    const status = result.status.padEnd(14).slice(0, 14)
    const time = String(result.loadTimeMs).padStart(10)
    const deps = result.dependsOn ? result.dependsOn.join(', ') : '-'
    
    lines.push(`  ${flag}  ${status}  ${time}  ${deps}`)
  }

  lines.push(separator)

  // Summary
  lines.push('')
  lines.push('  Summary:')
  lines.push(`    operational:  ${statusCounts.operational}`)
  lines.push(`    loadable:     ${statusCounts.loadable}`)
  lines.push(`    broken:       ${statusCounts.broken}`)
  lines.push(`    missing-dep:  ${statusCounts['missing-dep']}`)
  lines.push(`    ──────────────────────`)
  lines.push(`    total:        ${results.length}`)
  lines.push('')

  return lines.join('\n')
}

/**
 * Generate a JSON-only report (for programmatic consumption)
 */
export function generateJsonReport(results: FlagHealthResult[]): string {
  return JSON.stringify(results, null, 2)
}
