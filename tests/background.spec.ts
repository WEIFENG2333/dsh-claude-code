import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import { ClaudeBackgroundTasks } from '../src/tools/background.ts'

function start(id: string, run = 'run-1') {
  return {
    runId: SubagentRunId(run),
    provider: 'spawn',
    id: SessionId(id),
    local: true,
  }
}

describe('Claude background-task projection', () => {
  it('retains a fast completion observed before Agent registers its metadata', () => {
    const tasks = new ClaudeBackgroundTasks(new Context())
    tasks.observeStart(start('agent-fast'))
    tasks.observeEnd({
      ...start('agent-fast'),
      stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: 'WORKER_READY' }],
    })

    expect(tasks.register('agent-fast', 'Answer briefly', 'Return WORKER_READY')).toEqual({
      id: 'agent-fast',
      description: 'Answer briefly',
      prompt: 'Return WORKER_READY',
      status: 'completed',
      output: 'WORKER_READY',
    })
  })

  it('tracks a follow-up as a fresh waitable epoch and supports rollback', async () => {
    const tasks = new ClaudeBackgroundTasks(new Context())
    tasks.register('agent-next', 'Continue work', 'First prompt')
    tasks.observeEnd({ ...start('agent-next'), stopReason: 'completed' })

    const prepared = tasks.prepareTurn('agent-next')
    expect(prepared?.previousStatus).toBe('completed')
    expect(tasks.get('agent-next')?.status).toBe('pending')
    prepared?.rollback()
    expect(tasks.get('agent-next')?.status).toBe('completed')

    tasks.prepareTurn('agent-next')
    tasks.observeStart(start('agent-next', 'run-2'))
    const wait = tasks.wait('agent-next', 1_000, new AbortController().signal)
    queueMicrotask(() => tasks.observeEnd({
      ...start('agent-next', 'run-2'),
      stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: 'SECOND' }],
    }))
    await expect(wait).resolves.toBe(true)
    expect(tasks.get('agent-next')).toMatchObject({ status: 'completed', output: 'SECOND' })
  })
})
