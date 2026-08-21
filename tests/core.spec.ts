import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { coreToolBodies } from '../src/tools/core.ts'
import { ClaudeWorkspace } from '../src/tools/workspace.ts'

describe('provider-neutral Claude tools', () => {
  it('routes WebFetch through the model selected for the calling session', async () => {
    const requests: GenerateOptions[] = []
    const stream = (options: GenerateOptions): AsyncIterable<StreamChunk> => {
      requests.push(options)
      return (async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    }
    const ctx = {
      llm: { stream },
      tools: {
        execute: vi.fn(() => Promise.resolve({
          isError: false,
          value: { content: [{ type: 'text', text: 'fetched page' }] },
          content: [{ type: 'text', text: 'fetched page' }],
        })),
      },
    } as unknown as Context
    const agent = {
      options: { provider: 'startup-provider', model: 'startup-model' },
      session: {
        requestHeader: () => ({
          config: { provider: 'selected-provider', model: 'selected-model' },
        }),
      },
    } as unknown as Agent
    const exec = {
      callId: CallId('web-fetch'),
      rootCallId: CallId('web-fetch'),
      token: {},
      agent,
      signal: new AbortController().signal,
      deferContext: vi.fn(),
      concludeTurn: vi.fn(),
    } as unknown as ToolRunContext
    const webFetch = coreToolBodies(ctx, {
      webFetchMaxTokens: 1_234,
      workspace: new ClaudeWorkspace(),
    }).WebFetch
    if (webFetch === undefined) throw new Error('WebFetch body is missing')

    await webFetch({ url: 'https://example.com', prompt: 'Summarize' }, exec)

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      provider: 'selected-provider',
      model: 'selected-model',
      maxTokens: 1_234,
    })
  })
})
