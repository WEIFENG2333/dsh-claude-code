import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ClaudeToolBody } from '../src/tools/runtime.ts'
import { remoteTriggerBody } from '../src/tools/remote-trigger.ts'

const temporary: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function execution(): Parameters<ClaudeToolBody>[1] {
  return { signal: new AbortController().signal } as Parameters<ClaudeToolBody>[1]
}

describe('RemoteTrigger', () => {
  it('adds Claude OAuth in-process and returns only the remote response', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-trigger-'))
    temporary.push(root)
    await writeFile(join(root, '.credentials.json'), JSON.stringify({
      claudeAiOauth: { accessToken: 'fixture-access-token', expiresAt: Date.now() + 60_000 },
      organizationUuid: 'fixture-organization',
    }))
    const requests: Request[] = []
    vi.stubGlobal('fetch', vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return Promise.resolve(new Response('{"runs":[]}', { status: 200 }))
    }))

    const output = await remoteTriggerBody(root)({
      action: 'list_runs',
      trigger_id: 'routine-1',
      cursor: 'next-page',
    }, execution())

    expect(output).toBe('HTTP 200\n{"runs":[]}')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('https://api.anthropic.com/v1/code/sessions?trigger_id=routine-1&cursor=next-page')
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer fixture-access-token')
    expect(requests[0]?.headers.get('x-organization-uuid')).toBe('fixture-organization')
    expect(String(output)).not.toContain('fixture-access-token')
  })

  it('fails clearly when Claude Code has no local login', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-claude-trigger-'))
    temporary.push(root)

    await expect(remoteTriggerBody(root)({ action: 'list' }, execution()))
      .rejects.toThrow('requires a claude.ai login')
  })
})
