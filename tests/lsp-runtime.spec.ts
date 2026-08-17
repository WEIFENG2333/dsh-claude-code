import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { resolveLspServers } from '../src/lsp-runtime.ts'

describe('LSP runtime server selection', () => {
  it('auto-detects when Schemastery materializes an omitted server dictionary as empty', async () => {
    const resolveExecutable = vi.fn((command: string) => {
      if (command === 'gopls') return Promise.resolve('/tools/gopls')
      return Promise.reject(new Error('not installed'))
    })
    const ctx = { subprocess: { resolveExecutable } } as unknown as Context

    const servers = await resolveLspServers(ctx, { autoDetect: true, servers: {} })

    expect(servers.gopls).toEqual({
      command: '/tools/gopls',
      extensionToLanguage: { '.go': 'go' },
    })
    expect(resolveExecutable).toHaveBeenCalledWith('gopls', {}, expect.any(AbortSignal))
  })

  it('keeps non-empty explicit configuration authoritative', async () => {
    const resolveExecutable = vi.fn()
    const ctx = { subprocess: { resolveExecutable } } as unknown as Context
    const configured = {
      custom: {
        command: '/tools/custom-lsp',
        extensionToLanguage: { '.custom': 'custom' },
      },
    }

    await expect(resolveLspServers(ctx, { autoDetect: true, servers: configured })).resolves.toBe(configured)
    expect(resolveExecutable).not.toHaveBeenCalled()
  })
})
