import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('feature flag dependency graph', () => {
  const docPath = join(import.meta.dir, '../../../docs/feature-flag-dependency-graph.md')
  const content = readFileSync(docPath, 'utf-8')

  test('document exists and is non-empty', () => {
    expect(content.length).toBeGreaterThan(500)
  })

  test('contains Quick Reference table', () => {
    expect(content).toContain('## Quick Reference')
    expect(content).toContain('| Flag |')
  })

  test('lists critical flags', () => {
    for (const flag of [
      'KAIROS',
      'COORDINATOR_MODE',
      'CONTEXT_COLLAPSE',
      'PROACTIVE',
      'EXTRACT_MEMORIES',
    ]) {
      expect(content).toContain(flag)
    }
  })

  test('documents co-dependencies', () => {
    expect(content).toContain('Co-Dependencies')
    // KAIROS requires KAIROS_BRIEF
    expect(content).toMatch(/KAIROS.*KAIROS_BRIEF/s)
  })

  test('Quick Reference table has at least 20 entries', () => {
    // Count rows in the Quick Reference table (lines matching "| FLAG |")
    const quickRefSection = content.split('## Quick Reference')[1]?.split('## ')[0] ?? ''
    // Each data row starts with "| " and has a flag name
    const rows = quickRefSection
      .split('\n')
      .filter(line => line.startsWith('| ') && !line.startsWith('| Flag') && !line.startsWith('|---'))
    expect(rows.length).toBeGreaterThanOrEqual(20)
  })

  test('documents the dependency graph section', () => {
    expect(content).toContain('## Dependency Graph')
    expect(content).toContain('KAIROS ──requires──> KAIROS_BRIEF')
    expect(content).toContain('COORDINATOR_MODE ──enables──> SendMessageTool')
    expect(content).toContain('CONTEXT_COLLAPSE ──enables──> CtxInspectTool')
    expect(content).toContain('PROACTIVE ──overlaps──> KAIROS')
  })
})
