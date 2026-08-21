import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { ClaudeCodeAdapter } from '../src/adapter.ts'
import { CLAUDE_CODE_BASELINE } from '../src/generated/claude-code-baseline.ts'
import { capturedSystemPrompt } from '../src/request.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Anthropic-compatible transport', () => {
  it('sends the captured body and preserves thinking signatures for replay', async () => {
    let requestUrl = ''
    let requestInit: RequestInit | undefined
    const events = [
      { type: 'message_start', message: { id: 'message-1', model: 'deepseek-v4-flash', usage: { input_tokens: 7, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'signed-thinking' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'OK' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 7, output_tokens: 2 } },
      { type: 'message_stop' },
    ]
    const sse = `${events.map(data => `event: ${data.type}\ndata: ${JSON.stringify(data)}`).join('\n\n')}\n\n`
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(url)
      requestInit = init
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    })

    const adapter = new ClaudeCodeAdapter({
      config: () => ({
        provider: 'deepseek-claude-code',
        baseURL: 'https://api.deepseek.com/anthropic',
        model: 'deepseek-v4-flash',
        maxTokens: 32_000,
        effort: 'max',
        contextWindow: 1_000_000,
        requestTimeoutMs: 60_000,
        deviceId: 'a'.repeat(64),
        sessionId: 'session-fixed',
      }),
      resolveApiKey: () => Promise.resolve('test-key'),
    })
    const tools = CLAUDE_CODE_BASELINE.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: structuredClone(tool.input_schema) as Record<string, unknown>,
    }))
    const assembler = new BlockAssembler()
    for await (const chunk of adapter.stream({
      provider: 'deepseek-claude-code',
      model: 'deepseek-v4-flash',
      system: capturedSystemPrompt('deepseek-v4-flash'),
      tools,
      messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Say OK' }] })],
    })) assembler.push(chunk)

    expect(requestUrl).toBe(`https://api.deepseek.com/anthropic${CLAUDE_CODE_BASELINE.requestPath}`)
    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>
    expect(body.tools).toEqual(CLAUDE_CODE_BASELINE.tools)
    expect(Object.keys(body)).toEqual([
      'model', 'messages', 'system', 'tools', 'metadata', 'max_tokens',
      'thinking', 'context_management', 'output_config', 'stream',
    ])
    expect(assembler.blocks()).toEqual([{ type: 'text', text: 'OK' }])
    expect(assembler.usage).toEqual({ inputTokens: 7, outputTokens: 2 })
    expect(assembler.replayState).toMatchObject({
      response: {
        protocol: 'anthropic-messages',
        content: [
          { type: 'thinking', thinking: '', signature: 'signed-thinking' },
          { type: 'text', text: 'OK' },
        ],
      },
    })
  })
})
