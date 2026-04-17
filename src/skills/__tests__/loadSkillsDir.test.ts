import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  createSkillCommand,
  loadFullSkillMarkdownContent,
  parseSkillFrontmatterFields,
  readSkillMetadataPreview,
} from '../loadSkillsDir.js'

const tempDirs: string[] = []

afterEach(async () => {
  delete process.env.CLAUDE_CODE_SKILL_METADATA_READ_BYTES
  await Promise.all(
    tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

async function writeSkillFile(content: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'ccr-skill-'))
  tempDirs.push(tempDir)
  const skillDir = join(tempDir, 'demo-skill')
  await mkdir(skillDir, { recursive: true })
  const skillFilePath = join(skillDir, 'SKILL.md')
  await writeFile(skillFilePath, content, 'utf-8')
  return skillFilePath
}

describe('loadSkillsDir lazy skill metadata loading', () => {
  test('reads metadata preview without loading full skill body', async () => {
    const skillFilePath = await writeSkillFile(`---
description: Big skill description
when_to_use: Use when testing startup latency
---
# Big Skill
${'A'.repeat(40_000)}
`)

    const metadata = await readSkillMetadataPreview(skillFilePath)

    expect(metadata.frontmatter.description).toBe('Big skill description')
    expect(metadata.frontmatter.when_to_use).toBe(
      'Use when testing startup latency',
    )
    expect(metadata.contentLength).toBeGreaterThan(metadata.markdownPreview.length)
  })

  test('falls back to full read when frontmatter would be truncated', async () => {
    process.env.CLAUDE_CODE_SKILL_METADATA_READ_BYTES = '64'

    const skillFilePath = await writeSkillFile(`---
description: Truncated frontmatter description should still parse
when_to_use: Even tiny previews must preserve metadata
allowed-tools:
  - Bash
  - Read
---
# Skill body
Hello
`)

    const metadata = await readSkillMetadataPreview(skillFilePath)

    expect(metadata.frontmatter.description).toBe(
      'Truncated frontmatter description should still parse',
    )
    expect(metadata.frontmatter.when_to_use).toBe(
      'Even tiny previews must preserve metadata',
    )
  })

  test('loads the full skill markdown only when invoked', async () => {
    process.env.CLAUDE_CODE_SKILL_METADATA_READ_BYTES = '64'

    const skillFilePath = await writeSkillFile(`---
description: Lazy skill
when_to_use: Invoke lazily
---
# Lazy Skill
Prelude
${'B'.repeat(8_000)}
TAIL_SENTINEL
`)

    const metadata = await readSkillMetadataPreview(skillFilePath)
    const parsed = parseSkillFrontmatterFields(
      metadata.frontmatter,
      metadata.markdownPreview,
      'demo-skill',
    )

    const command = createSkillCommand({
      ...parsed,
      skillName: 'demo-skill',
      markdownContentLoader: () => loadFullSkillMarkdownContent(skillFilePath),
      contentLength: metadata.contentLength,
      source: 'projectSettings',
      baseDir: dirname(skillFilePath),
      loadedFrom: 'skills',
      paths: undefined,
    })

    if (command.type !== 'prompt') {
      throw new Error('Expected prompt command')
    }

    const blocks = await command.getPromptForCommand('', {} as never)
    const textBlock = blocks[0]

    expect(textBlock?.type).toBe('text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('Expected text block')
    }
    expect(textBlock.text).toContain('TAIL_SENTINEL')
  })
})
