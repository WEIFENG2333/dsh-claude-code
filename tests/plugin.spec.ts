import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { CLAUDE_CODE_BASELINE } from '../src/generated/claude-code-baseline.ts'
import * as ClaudeCodeAgent from '../src/agent.ts'
import * as ClaudeCodeMode from '../src/index.ts'
import { capturedSystemPrompt } from '../src/request.ts'

async function runtime(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, persona: 'Standard stays active.' })
  await ctx.plugin(ToolRuntime)
  ctx.systemPrompt.variable('model', () => CLAUDE_CODE_BASELINE.defaults.model)
  return ctx
}

async function agentSurface(): Promise<Context> {
  const ctx = await runtime()
  await ctx.plugin(ClaudeCodeMode)
  await ctx.plugin(ClaudeCodeAgent)
  return ctx
}

describe('Claude Code mode host', () => {
  it('registers an independent Web preset without changing the global prompt or tools', async () => {
    const ctx = await runtime()
    const registerRoot = vi.fn(() => () => undefined)
    ctx.provide('agentPresets', { registerRoot })

    await ctx.plugin(ClaudeCodeMode)

    expect(registerRoot).toHaveBeenCalledOnce()
    expect(registerRoot).toHaveBeenCalledWith({
      id: 'dsh-claude-code',
      path: expect.stringMatching(/[/\\]presets$/u),
    })
    const assembly = await ctx.systemPrompt.assemble()
    expect(renderPrompt(assembly)).toBe('Standard stays active.')
    expect(assembly.tools).toEqual([])
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('installs the same Claude surface automatically in headless profiles', async () => {
    const ctx = await runtime()
    ctx.provide('headlessStartup', { task: 'test' })

    await ctx.plugin(ClaudeCodeMode)

    const assembly = await ctx.systemPrompt.assemble()
    expect(renderPrompt(assembly)).toBe(capturedSystemPrompt())
    expect(assembly.tools.map(tool => tool.name)).toEqual(
      CLAUDE_CODE_BASELINE.tools.map(tool => tool.name),
    )
  })
})

describe('Claude Code agent surface', () => {
  it('publishes only the captured prompt and exact ordered tool schemas', async () => {
    const ctx = await agentSurface()
    const assembly = await ctx.systemPrompt.assemble()
    expect(renderPrompt(assembly)).toBe(capturedSystemPrompt())
    expect(assembly.contexts.map(context => context.name)).toEqual([
      'claude-code:current-date',
      'claude-code:agent-catalog',
    ])
    expect(assembly.tools.map(tool => tool.name)).toEqual(CLAUDE_CODE_BASELINE.tools.map(tool => tool.name))
    expect(assembly.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }))).toEqual(CLAUDE_CODE_BASELINE.tools)
  })

  it('wraps captured input-validation failures in Claude tool-result markup', async () => {
    const ctx = await agentSurface()
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

  it('does not expose optional tools absent from the current capture', async () => {
    const ctx = await agentSurface()
    const signal = new AbortController().signal
    const mcp = await ctx.tools.execute({
      callId: CallId('mcp-ready'),
      name: 'WaitForMcpServers',
      arguments: {},
      signal,
    })
    expect(mcp.isError).toBe(true)

    const lsp = await ctx.tools.execute({
      callId: CallId('lsp-unavailable'),
      name: 'LSP',
      arguments: { operation: 'hover', filePath: 'x.ts', line: 1, character: 1 },
      signal,
    })
    expect(lsp.isError).toBe(true)
  })
})
