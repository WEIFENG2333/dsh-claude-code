import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CLAUDE_CODE_BASELINE } from '../src/generated/claude-code-baseline.ts'
import * as ClaudeCodeCompat from '../src/index.ts'
import { capturedSystemPrompt } from '../src/request.ts'

class TestCredentials extends CredentialProvider {
  override resolve(_ref: CredentialRef): Promise<ResolvedCredential> {
    return Promise.resolve({ value: 'test-key', source: 'test' })
  }

  override describe(_ref: CredentialRef): Promise<CredentialInfo> {
    return Promise.resolve({ configured: true, source: 'test', writable: false })
  }

  override set(_ref: CredentialRef, _value: string): Promise<void> {
    return Promise.reject(new Error('read-only test credentials'))
  }

  override unset(_ref: CredentialRef): Promise<void> {
    return Promise.reject(new Error('read-only test credentials'))
  }
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TestCredentials)
  await ctx.plugin(ClaudeCodeCompat, { deviceId: 'a'.repeat(64) })
  return ctx
}

describe('compatibility plugin assembly', () => {
  it('publishes only the captured prompt and exact ordered tool schemas', async () => {
    const ctx = await setup()
    const assembly = await ctx.systemPrompt.assemble()
    expect(renderPrompt(assembly)).toBe(capturedSystemPrompt())
    expect(assembly.tools.map(tool => tool.name)).toEqual(CLAUDE_CODE_BASELINE.tools.map(tool => tool.name))
    expect(assembly.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }))).toEqual(CLAUDE_CODE_BASELINE.tools)
  })

  it('wraps captured input-validation failures in Claude tool-result markup', async () => {
    const ctx = await setup()
    const result = await ctx.tools.execute({
      callId: CallId('invalid-write'),
      name: 'Write',
      arguments: {},
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{
      type: 'text',
      text: expect.stringMatching(/^<tool_use_error>.*required property.*<\/tool_use_error>$/u),
    }])
  })

  it('reports MCP startup readiness and an absent optional LSP without crashing the profile', async () => {
    const ctx = await setup()
    const signal = new AbortController().signal
    const mcp = await ctx.tools.execute({
      callId: CallId('mcp-ready'),
      name: 'WaitForMcpServers',
      arguments: {},
      signal,
    })
    expect(mcp.isError).toBe(false)
    if (mcp.isError) throw new Error('unreachable')
    expect(mcp.value).toMatchObject({ ready: true, servers: [] })

    const lsp = await ctx.tools.execute({
      callId: CallId('lsp-unavailable'),
      name: 'LSP',
      arguments: { operation: 'hover', filePath: 'x.ts', line: 1, character: 1 },
      signal,
    })
    expect(lsp.isError).toBe(true)
    expect(lsp.content).toEqual([{
      type: 'text',
      text: '<tool_use_error>No LSP server is configured for this DSH profile</tool_use_error>',
    }])
  })
})
