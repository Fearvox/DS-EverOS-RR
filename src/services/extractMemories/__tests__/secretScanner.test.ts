/**
 * Unit tests for the secret scanner (Phase 6-03 MEM-03).
 *
 * Tests cover:
 * - Detection of each secret pattern category
 * - Clean content returns empty findings
 * - False positive resistance (placeholders, masked values, short mentions)
 * - Finding format (line numbers, truncation, pattern names)
 * - Integration with createAutoMemCanUseTool (Write/Edit blocking)
 */

import { describe, test, expect, beforeEach, afterAll } from 'bun:test'
import { mock } from 'bun:test'
import { randomUUID } from 'crypto'

import {
  scanForSecrets,
  containsSecrets,
  type SecretFinding,
} from '../secretScanner.js'

// ============================================================================
// Module mocks — required for createAutoMemCanUseTool integration tests
// ============================================================================

const TEST_MEMORY_DIR = '/tmp/test-home/.claude/projects/test/memory/'

mock.module('src/memdir/paths.js', () => ({
  getAutoMemPath: () => TEST_MEMORY_DIR,
  isAutoMemoryEnabled: () => true,
  isAutoMemPath: (p: string) => p.startsWith(TEST_MEMORY_DIR),
  isExtractModeActive: () => true,
  hasAutoMemPathOverride: () => false,
}))

mock.module('src/utils/featureFlag.js', () => ({
  feature: () => false,
  _reloadFlagsForTesting: () => {},
}))

mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))

mock.module('src/services/analytics/metadata.js', () => ({
  sanitizeToolNameForAnalytics: (n: string) => n,
}))

mock.module('src/utils/debug.js', () => ({
  logForDebugging: () => {},
}))

// Import createAutoMemCanUseTool AFTER mocks are set
import { createAutoMemCanUseTool } from '../extractMemories.js'
import type { Tool } from 'src/Tool.js'

// ============================================================================
// Test Helpers
// ============================================================================

function makeMockTool(
  name: string,
  opts?: {
    isReadOnly?: (input: unknown) => boolean
    safeParse?: (input: unknown) => { success: boolean; data?: unknown }
  },
): Tool {
  return {
    name,
    inputSchema: {
      safeParse:
        opts?.safeParse ??
        ((input: unknown) => ({ success: true, data: input })),
    },
    isReadOnly: opts?.isReadOnly ?? (() => false),
  } as unknown as Tool
}

// ============================================================================
// 1. Pattern Detection — one test per category
// ============================================================================

afterAll(() => {
  mock.restore()
})

describe('secretScanner', () => {
  describe('pattern detection', () => {
    test('detects AWS Access Key', () => {
      const content = 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE'
      const findings = scanForSecrets(content)
      expect(findings.length).toBeGreaterThanOrEqual(1)
      expect(findings.some(f => f.pattern === 'AWS Access Key')).toBe(true)
    })

    test('detects AWS Secret Key', () => {
      const content =
        'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
      const findings = scanForSecrets(content)
      expect(findings.length).toBeGreaterThanOrEqual(1)
      expect(findings.some(f => f.pattern === 'AWS Secret Key')).toBe(true)
    })

    test('detects GitHub Token (ghp_)', () => {
      const content =
        'GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn'
      const findings = scanForSecrets(content)
      expect(findings.some(f => f.pattern === 'GitHub Token')).toBe(true)
    })

    test('detects GitHub OAuth (gho_)', () => {
      const content =
        'oauth_token=gho_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn'
      const findings = scanForSecrets(content)
      expect(findings.some(f => f.pattern === 'GitHub OAuth')).toBe(true)
    })

    test('detects Anthropic API key', () => {
      const content =
        'api_key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456'
      const findings = scanForSecrets(content)
      expect(findings.length).toBeGreaterThan(0)
      expect(findings[0].pattern).toBe('Anthropic API Key')
    })

    test('detects Generic API Key (sk-)', () => {
      const content =
        'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz'
      const findings = scanForSecrets(content)
      expect(findings.some(f => f.pattern === 'Generic API Key')).toBe(true)
    })

    test('detects Slack Token', () => {
      const content = 'SLACK_TOKEN=xoxb-123456789012-abcdefghij'
      const findings = scanForSecrets(content)
      expect(findings.some(f => f.pattern === 'Slack Token')).toBe(true)
    })

    test('detects SSH Private Key header', () => {
      const content = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK...'
      const findings = scanForSecrets(content)
      expect(findings.some(f => f.pattern === 'SSH Private Key')).toBe(true)
    })

    test('detects JWT Token', () => {
      const content =
        'token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
      const findings = scanForSecrets(content)
      expect(findings.some(f => f.pattern === 'JWT Token')).toBe(true)
    })

    test('detects Database URL', () => {
      const content =
        'DATABASE_URL=postgres://admin:s3cret@db.example.com:5432/mydb'
      const findings = scanForSecrets(content)
      expect(findings.some(f => f.pattern === 'Database URL')).toBe(true)
    })

    test('detects Generic SECRET= assignment', () => {
      const content = 'SECRET=mySecretValue123'
      const findings = scanForSecrets(content)
      expect(
        findings.some(f => f.pattern === 'Generic Secret Assignment'),
      ).toBe(true)
    })
  })

  // ============================================================================
  // 2. Clean content
  // ============================================================================

  describe('clean content', () => {
    test('returns empty findings for normal markdown memory content', () => {
      const content = `---
type: learning
description: How to configure Bun test runner
---

## Bun Test Runner

- Use \`bun test\` to run tests
- Supports \`.test.ts\` file pattern
- Mock modules with \`mock.module()\`
`
      const findings = scanForSecrets(content)
      expect(findings).toEqual([])
    })

    test('returns empty findings for code snippets without real secrets', () => {
      const content = `## Code Pattern

\`\`\`typescript
const config = {
  retries: 3,
  timeout: 5000,
  baseUrl: 'https://api.example.com',
}
\`\`\`
`
      const findings = scanForSecrets(content)
      expect(findings).toEqual([])
    })

    test('returns empty findings for frontmatter with description/type fields', () => {
      const content = `---
type: project
description: CCR reverse-engineering project
tags: [bun, typescript, cli]
created: 2026-04-14
---

Project notes here.
`
      const findings = scanForSecrets(content)
      expect(findings).toEqual([])
    })
  })

  // ============================================================================
  // 3. False positive resistance
  // ============================================================================

  describe('false positive resistance', () => {
    test('SECRET=<your-key> is NOT flagged (placeholder)', () => {
      const content = 'SECRET=<your-key>'
      const findings = scanForSecrets(content)
      // The generic assignment regex requires 8+ alphanumeric chars;
      // <your-key> contains angle brackets so won't match the value group
      expect(
        findings.filter(f => f.pattern === 'Generic Secret Assignment').length,
      ).toBe(0)
    })

    test('SECRET=xxx is NOT flagged (placeholder, too short)', () => {
      const content = 'SECRET=xxx'
      const findings = scanForSecrets(content)
      // "xxx" is only 3 chars — does not meet the {8,} minimum
      expect(
        findings.filter(f => f.pattern === 'Generic Secret Assignment').length,
      ).toBe(0)
    })

    test('documentation mentioning "sk-" in prose is NOT flagged (too short)', () => {
      const content =
        'The API key prefix sk- indicates a secret key in Stripe/OpenAI.'
      const findings = scanForSecrets(content)
      // "sk-" alone has 0 trailing alphanum chars, well under the 20 minimum
      expect(
        findings.filter(f => f.pattern === 'Generic API Key').length,
      ).toBe(0)
    })

    test('PASSWORD=******** is NOT flagged (masked)', () => {
      const content = 'PASSWORD=********'
      const findings = scanForSecrets(content)
      // Asterisks don't match [A-Za-z0-9/+_-]{8,}
      expect(
        findings.filter(f => f.pattern === 'Generic Secret Assignment').length,
      ).toBe(0)
    })
  })

  // ============================================================================
  // 4. Finding format
  // ============================================================================

  describe('finding format', () => {
    test('line number is correct (1-based)', () => {
      const content = 'line one\nline two\nAKIAIOSFODNN7EXAMPLE here\nline four'
      const findings = scanForSecrets(content)
      expect(findings.length).toBe(1)
      expect(findings[0].line).toBe(3)
    })

    test('match is truncated (first 8 chars + "...")', () => {
      const content = 'key=AKIAIOSFODNN7EXAMPLE'
      const findings = scanForSecrets(content)
      const awsFinding = findings.find(f => f.pattern === 'AWS Access Key')
      expect(awsFinding).toBeDefined()
      // AKIAIOSF + ...
      expect(awsFinding!.match).toBe('AKIAIOSF...')
    })

    test('pattern name is descriptive', () => {
      const content = '-----BEGIN PRIVATE KEY-----'
      const findings = scanForSecrets(content)
      expect(findings.length).toBe(1)
      expect(findings[0].pattern).toBe('SSH Private Key')
    })
  })

  // ============================================================================
  // 5. containsSecrets convenience wrapper
  // ============================================================================

  describe('containsSecrets', () => {
    test('returns true for content with secrets', () => {
      expect(containsSecrets('key=AKIAIOSFODNN7EXAMPLE')).toBe(true)
    })

    test('returns false for clean content', () => {
      expect(containsSecrets('Just some normal text')).toBe(false)
    })
  })

  // ============================================================================
  // 6. Integration — createAutoMemCanUseTool with secret scanning
  // ============================================================================

  describe('createAutoMemCanUseTool secret integration', () => {
    const canUseTool = createAutoMemCanUseTool(TEST_MEMORY_DIR)

    test('denies Write with secrets in content', async () => {
      const tool = makeMockTool('Write')
      const memFile = `${TEST_MEMORY_DIR}topic.md`
      const result = await canUseTool(tool, {
        file_path: memFile,
        content: 'My AWS key is AKIAIOSFODNN7EXAMPLE and it works great',
      })
      expect(result.behavior).toBe('deny')
    })

    test('allows Write with clean content', async () => {
      const tool = makeMockTool('Write')
      const memFile = `${TEST_MEMORY_DIR}topic.md`
      const result = await canUseTool(tool, {
        file_path: memFile,
        content: '## Learning\n\nBun test runner supports mocking.',
      })
      expect(result.behavior).toBe('allow')
    })

    test('denies Edit with secrets in new_string', async () => {
      const tool = makeMockTool('Edit')
      const memFile = `${TEST_MEMORY_DIR}topic.md`
      const result = await canUseTool(tool, {
        file_path: memFile,
        old_string: 'placeholder',
        new_string:
          'Use token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn for auth',
      })
      expect(result.behavior).toBe('deny')
    })

    test('allows Edit with clean new_string', async () => {
      const tool = makeMockTool('Edit')
      const memFile = `${TEST_MEMORY_DIR}topic.md`
      const result = await canUseTool(tool, {
        file_path: memFile,
        old_string: 'old text',
        new_string: 'Updated learning about Bun workspaces',
      })
      expect(result.behavior).toBe('allow')
    })

    test('denies Write when content is undefined (bypass prevention)', async () => {
      const tool = makeMockTool('Write')
      const memFile = `${TEST_MEMORY_DIR}topic.md`
      const result = await canUseTool(tool, {
        file_path: memFile,
        // content intentionally missing — simulates undefined bypass
      })
      expect(result.behavior).toBe('deny')
    })

    test('allows Edit when new_string is undefined (deletion-only edit)', async () => {
      const tool = makeMockTool('Edit')
      const memFile = `${TEST_MEMORY_DIR}topic.md`
      const result = await canUseTool(tool, {
        file_path: memFile,
        old_string: 'text to delete',
        // new_string intentionally missing — deletion-only edit is valid
      })
      expect(result.behavior).toBe('allow')
    })
  })
})
