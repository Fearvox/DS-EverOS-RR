import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'

describe('flag-report command', () => {
  let savedEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    savedEnv = { ...process.env }
    // Clear CLAUDE_FEATURE_ env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('CLAUDE_FEATURE_')) {
        delete process.env[key]
      }
    }
    process.env.HOME = process.env.HOME || '/tmp/home-test'
  })

  afterEach(async () => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key]
      }
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    // Clean up test report file if it was created
    const reportPath = join(process.cwd(), '.planning', 'FLAG-BLITZ-REPORT.md')
    if (existsSync(reportPath)) {
      try {
        unlinkSync(reportPath)
      } catch {
        // ignore
      }
    }
  })

  // Test 1: flagReport command is registered with correct name 'flag-report'
  test('flagReport command is registered with correct name', async () => {
    // We need to import the command registration
    const { default: flagReportCmd } = await import('../index.js')
    expect(flagReportCmd.name).toBe('flag-report')
    expect(flagReportCmd.type).toBe('local')
  })

  // Test 2: getFlagReportData() returns expected shape
  test('getFlagReportData() returns expected shape', async () => {
    // Import the command module
    const { call } = await import('../flagReport.js')
    
    // call signature: (args: string) => Promise<{ type: 'text', value: string }>
    const result = await call('')
    
    expect(result).toHaveProperty('type', 'text')
    expect(result).toHaveProperty('value')
    expect(typeof result.value).toBe('string')
  })

  // Test 3: report format matches specification (box-drawing characters)
  test('report format contains box-drawing characters', async () => {
    const { call } = await import('../flagReport.js')
    const result = await call('')
    
    // Check for box-drawing characters
    expect(result.value).toContain('╔')
    expect(result.value).toContain('║')
    expect(result.value).toContain('╚')
    expect(result.value).toContain('═')
    expect(result.value).toContain('╠')
  })

  // Test 4: report contains expected sections
  test('report contains expected sections', async () => {
    const { call } = await import('../flagReport.js')
    const result = await call('')
    
    expect(result.value).toContain('CCR FLAG BLITZ REPORT')
    // Should have operational/broken counts
    expect(result.value).toMatch(/Operational:\s*\d+/)
    expect(result.value).toMatch(/Broken:\s*\d+/)
  })

  // Test 5: saves report to .planning/FLAG-BLITZ-REPORT.md
  test('saves report to .planning/FLAG-BLITZ-REPORT.md', async () => {
    const { call } = await import('../flagReport.js')
    
    // Ensure .planning directory exists
    const planningDir = join(process.cwd(), '.planning')
    const reportPath = join(planningDir, 'FLAG-BLITZ-REPORT.md')
    
    // Call the command
    await call('')
    
    // Check file was created
    expect(existsSync(reportPath)).toBe(true)
    
    // Check content
    const content = readFileSync(reportPath, 'utf-8')
    expect(content).toContain('CCR FLAG BLITZ REPORT')
    expect(content).toContain('## Summary')
  })

  // Test 6: report contains gate decoupling status
  test('report contains gate decoupling status', async () => {
    const { call } = await import('../flagReport.js')
    const result = await call('')
    
    // Should mention gates
    expect(result.value).toMatch(/Gates?/)
  })
})
