import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { captureClaudeInstructions } from '../src/instructions.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Claude instruction discovery', () => {
  it('keeps user, project, local, and auto-memory files in Claude order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-instructions-'))
    roots.push(root)
    const config = join(root, 'config')
    const project = join(root, 'project')
    await mkdir(join(config, 'memory'), { recursive: true })
    await mkdir(join(project, '.claude', 'rules'), { recursive: true })
    await writeFile(join(config, 'CLAUDE.md'), 'USER', 'utf8')
    await writeFile(join(config, 'memory', 'MEMORY.md'), 'MEMORY', 'utf8')
    await writeFile(join(project, 'CLAUDE.md'), 'PROJECT', 'utf8')
    await writeFile(join(project, '.claude', 'rules', 'a.md'), 'RULE', 'utf8')
    await writeFile(join(project, 'CLAUDE.local.md'), 'LOCAL', 'utf8')

    const result = captureClaudeInstructions(project, config)
    expect(result).toBeDefined()
    const indexes = ['USER', 'PROJECT', 'RULE', 'LOCAL', 'MEMORY'].map(value => result!.indexOf(value))
    expect(indexes).toEqual(indexes.toSorted((a, b) => a - b))
    expect(result).toContain("(user's auto-memory, persists across conversations)")
  })
})
