import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CallId,
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { CLAUDE_CODE_BASELINE } from '../src/generated/claude-code-baseline.ts'
import {
  buildClaudeRequest,
  captureRuntimeEnvironment,
  capturedSystemPrompt,
  currentDateReminder,
  materializeCapturedSystem,
} from '../src/request.ts'

const DEVICE_ID = 'a'.repeat(64)

afterEach(() => {
  vi.useRealTimers()
})

describe('Claude Code request serialization', () => {
  it('reproduces the captured first request body and property order', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-18T12:00:00Z'))
    const prompt = 'Reply with exactly OK. Do not use tools.'
    const tools: ToolSchema[] = CLAUDE_CODE_BASELINE.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: structuredClone(tool.input_schema) as Record<string, unknown>,
    }))
    const built = await buildClaudeRequest({
      provider: 'deepseek-claude-code',
      model: 'deepseek-v4-flash',
      reasoningEffort: ReasoningEffortId('max'),
      maxTokens: 32_000,
      sessionId: SessionId('session-fixed'),
      system: capturedSystemPrompt('deepseek-v4-flash'),
      tools,
      messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] })],
    }, {
      model: 'deepseek-v4-flash',
      maxTokens: 32_000,
      effort: 'max',
      timeZone: 'UTC',
      deviceId: DEVICE_ID,
      accountUuid: '',
      sessionId: 'session-fixed',
    })

    const expected = {
      model: 'deepseek-v4-flash',
      messages: [
        {
          role: 'user',
          content: [
            {
              ...structuredClone(CLAUDE_CODE_BASELINE.initialContext.currentDateReminderBlock),
              text: currentDateReminder(new Date(), 'UTC'),
            },
            { type: 'text', text: prompt },
          ],
        },
        structuredClone(CLAUDE_CODE_BASELINE.initialContext.agentContextMessage),
      ],
      system: structuredClone(materializeCapturedSystem(
        captureRuntimeEnvironment('deepseek-v4-flash'),
      ).blocks),
      tools: structuredClone(CLAUDE_CODE_BASELINE.tools),
      metadata: {
        user_id: JSON.stringify({
          device_id: DEVICE_ID,
          account_uuid: '',
          session_id: 'session-fixed',
        }),
      },
      max_tokens: 32_000,
      thinking: structuredClone(CLAUDE_CODE_BASELINE.defaults.thinking),
      context_management: structuredClone(CLAUDE_CODE_BASELINE.defaults.contextManagement),
      output_config: { effort: 'max' },
      stream: true,
    }
    expect(JSON.stringify(built.body)).toBe(JSON.stringify(expected))
    expect(Object.keys(built.body)).toEqual([
      'model',
      'messages',
      'system',
      'tools',
      'metadata',
      'max_tokens',
      'thinking',
      'context_management',
      'output_config',
      'stream',
    ])
  })

  it('fails closed when DSH changes a captured tool schema', async () => {
    const tools: ToolSchema[] = CLAUDE_CODE_BASELINE.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: structuredClone(tool.input_schema) as Record<string, unknown>,
    }))
    tools[0] = { ...tools[0]!, description: 'drifted' }
    await expect(buildClaudeRequest({
      provider: 'deepseek-claude-code',
      model: 'deepseek-v4-flash',
      system: capturedSystemPrompt('deepseek-v4-flash'),
      tools,
      messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'x' }] })],
    }, {
      model: 'deepseek-v4-flash',
      maxTokens: 32_000,
      effort: 'max',
      deviceId: DEVICE_ID,
    })).rejects.toThrow('tool surface drifted')
  })

  it('keeps machine fields out of the baseline and hydrates one startup snapshot', () => {
    const baseline = JSON.stringify(CLAUDE_CODE_BASELINE)
    expect(baseline).not.toMatch(/\/(?:home|Users)\/[A-Za-z0-9._-]+\//u)
    const captured = materializeCapturedSystem({
      cwd: '/workspace/project',
      isGit: true,
      platform: 'linux',
      shell: 'bash',
      osVersion: 'Linux test-kernel',
      model: 'deepseek-v4-flash',
      memoryDirectory: '/config/memory/',
      gitStatus: 'fixture git status',
    })
    expect(captured.prompt).toContain(' - Primary working directory: /workspace/project')
    expect(captured.prompt).toContain(' - OS Version: Linux test-kernel')
    expect(captured.prompt).toContain('\n\ngitStatus: fixture git status')
    expect(captured.prompt).not.toContain('{{DSH_CLAUDE_CODE_')
  })

  it('coalesces parallel DSH tool results into the single user message Anthropic requires', async () => {
    const tools: ToolSchema[] = CLAUDE_CODE_BASELINE.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: structuredClone(tool.input_schema) as Record<string, unknown>,
    }))
    const first = CallId('parallel-1')
    const second = CallId('parallel-2')
    const built = await buildClaudeRequest({
      provider: 'deepseek-claude-code',
      model: 'deepseek-v4-flash',
      system: capturedSystemPrompt('deepseek-v4-flash'),
      tools,
      messages: [
        createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'run both' }] }),
        createAssistantMessage({
          source: { provider: 'deepseek-claude-code', model: 'deepseek-v4-flash' },
          content: [
            { type: 'tool-call', id: first, name: 'CronList', arguments: '{}' },
            { type: 'tool-call', id: second, name: 'ListAgents', arguments: '{}' },
          ],
        }),
        createToolResultMessage({ callId: first, content: [{ type: 'text', text: 'first' }], isError: false }),
        createToolResultMessage({ callId: second, content: [{ type: 'text', text: 'second' }], isError: false }),
      ],
    }, {
      model: 'deepseek-v4-flash',
      maxTokens: 32_000,
      effort: 'max',
      deviceId: DEVICE_ID,
    })

    const messages = built.body.messages as WireMessageForTest[]
    expect(messages.at(-1)).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'parallel-1', content: [{ type: 'text', text: 'first' }], is_error: false },
        { type: 'tool_result', tool_use_id: 'parallel-2', content: [{ type: 'text', text: 'second' }], is_error: false },
      ],
    })
  })

  it('retains coordinator follow-ups in a continuable child conversation', async () => {
    const tools: ToolSchema[] = CLAUDE_CODE_BASELINE.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: structuredClone(tool.input_schema) as Record<string, unknown>,
    }))
    const built = await buildClaudeRequest({
      provider: 'deepseek-claude-code',
      model: 'deepseek-v4-flash',
      system: capturedSystemPrompt('deepseek-v4-flash'),
      tools,
      messages: [
        createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'FIRST' }] }),
        createAssistantMessage({
          source: { provider: 'deepseek-claude-code', model: 'deepseek-v4-flash' },
          content: [{ type: 'text', text: 'FIRST_READY' }],
        }),
        createUserMessage({
          source: { kind: 'coordinator', form: 'relay', senderSessionId: SessionId('parent') },
          content: [
            { type: 'reasoning', text: 'private child reasoning' },
            { type: 'text', text: 'SECOND' },
          ],
        }),
      ],
    }, {
      model: 'deepseek-v4-flash',
      maxTokens: 32_000,
      effort: 'max',
      deviceId: DEVICE_ID,
    })

    const messages = built.body.messages as WireMessageForTest[]
    expect(messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'text', text: 'SECOND' }] })
  })
})

interface WireMessageForTest {
  readonly role: string
  readonly content: unknown[]
}
