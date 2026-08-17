import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ClaudeToolBody } from '../src/tools/runtime.ts'
import { LocalOnboardingGuides } from '../src/tools/onboarding.ts'
import { ClaudeWorkspace } from '../src/tools/workspace.ts'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function execution(cwd: string): Parameters<ClaudeToolBody>[1] {
  return {
    agent: { session: { id: 'test-session', header: { cwd } } },
  } as unknown as Parameters<ClaudeToolBody>[1]
}

describe('local onboarding guide fallback', () => {
  it('creates, discovers, and deletes a guide without claiming a hosted upload', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-claude-onboarding-workspace-'))
    const guideRoot = await mkdtemp(join(tmpdir(), 'dsh-claude-onboarding-store-'))
    temporary.push(workspaceRoot, guideRoot)
    await writeFile(join(workspaceRoot, 'ONBOARDING.md'), '# Welcome\n', 'utf8')
    const guides = new LocalOnboardingGuides(guideRoot, new ClaudeWorkspace())
    const exec = execution(workspaceRoot)

    const created = await guides.run({ mode: 'create' }, exec)
    const code = /guide ([a-f0-9]{8}):/u.exec(created)?.[1]
    expect(code).toBeDefined()
    expect(created).toContain('local onboarding guide')
    expect(await readFile(join(guideRoot, `${code}.md`), 'utf8')).toBe('# Welcome\n')

    await unlink(join(workspaceRoot, 'ONBOARDING.md'))
    await expect(guides.run({ mode: 'check', short_code: code }, exec))
      .resolves.toContain(`Existing local onboarding guide ${code}`)
    await expect(guides.run({ mode: 'delete', short_code: code }, exec))
      .resolves.toBe(`Deleted local onboarding guide ${code}.`)
  })
})
