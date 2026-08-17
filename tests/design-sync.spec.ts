import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DesignSyncStore } from '../src/tools/design-sync.ts'
import type { ClaudeToolBody } from '../src/tools/runtime.ts'
import { ClaudeWorkspace } from '../src/tools/workspace.ts'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected record')
  return value as Record<string, unknown>
}

function execution(cwd: string): Parameters<ClaudeToolBody>[1] {
  return { agent: { session: { id: 'design-session', header: { cwd } } } } as unknown as Parameters<ClaudeToolBody>[1]
}

describe('local DesignSync backend', () => {
  it('gates writes and assets through a finalized plan and persists validation counts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-design-'))
    temporary.push(root)
    const body = new DesignSyncStore(root, new ClaudeWorkspace()).body()
    const exec = execution(root)
    const project = record(await body({ method: 'create_project', name: 'Compat' }, exec))
    const projectId = String(project.projectId)
    const plan = record(await body({
      method: 'finalize_plan',
      projectId,
      writes: ['components/**'],
      deletes: ['components/**'],
    }, exec))
    const planId = String(plan.planId)

    await expect(body({
      method: 'write_files', projectId, planId, files: [{ path: 'outside.txt', data: 'no' }],
    }, exec)).rejects.toThrow('outside the finalized write plan')
    await body({
      method: 'write_files',
      projectId,
      planId,
      files: [{ path: 'components/button.html', data: '<h1>OK</h1>' }],
    }, exec)
    await body({
      method: 'register_assets',
      projectId,
      planId,
      assets: [{ name: 'Button', path: 'components/button.html' }],
    }, exec)
    await body({
      method: 'report_validate',
      projectId,
      counts: { total: 1, bad: 0, thin: 0, variantsIdentical: 0, iterations: 1 },
    }, exec)

    expect(await readFile(join(root, projectId, '.dsh-assets.json'), 'utf8')).toContain('components/button.html')
    expect(await readFile(join(root, projectId, '.dsh-validation.json'), 'utf8')).toContain('"total": 1')
    await body({ method: 'delete_files', projectId, planId, paths: ['components/button.html'] }, exec)
    await expect(body({ method: 'get_file', projectId, path: 'components/button.html' }, exec)).rejects.toThrow()
  })
})
