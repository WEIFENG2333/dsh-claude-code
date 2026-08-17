/** Claude-style lifecycle projection for DSH continuable subagents. */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentRunEndInfo, SubagentRunInfo } from '@deepseek-ai/dsh-subagent'

/** Status names exposed by Claude Code's local-agent tasks. */
export type ClaudeBackgroundStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed'

/** Immutable data used by TaskOutput and TaskStop. */
export interface ClaudeBackgroundSnapshot {
  readonly id: string
  readonly description: string
  readonly prompt: string
  readonly status: ClaudeBackgroundStatus
  readonly output: string
  readonly error?: string
}

interface Waiter {
  readonly promise: Promise<void>
  readonly resolve: () => void
}

interface BackgroundRecord {
  readonly id: string
  description: string
  prompt: string
  status: ClaudeBackgroundStatus
  output: string
  error?: string
  waiter: Waiter
}

interface SavedRecord {
  readonly description: string
  readonly prompt: string
  readonly status: ClaudeBackgroundStatus
  readonly output: string
  readonly error?: string
  readonly waiter: Waiter
}

/** Result of preparing a follow-up turn for one known subagent. */
export interface PreparedBackgroundTurn {
  readonly previousStatus: ClaudeBackgroundStatus
  /** Restore the preceding projection when native delivery fails. */
  rollback(): void
}

function waiter(): Waiter {
  let settle: (() => void) | undefined
  const promise = new Promise<void>((resolve) => {
    settle = resolve
  })
  return { promise, resolve: () => settle?.() }
}

function textContent(blocks: readonly ContentBlock[] | undefined): string {
  if (blocks === undefined) return ''
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

function terminalStatus(info: SubagentRunEndInfo): Pick<BackgroundRecord, 'status' | 'error'> {
  switch (info.stopReason) {
    case 'completed':
      return { status: 'completed' }
    case 'aborted':
      return { status: 'killed' }
    default:
      return { status: 'failed', error: `Subagent stopped with reason: ${info.stopReason}` }
  }
}

function saved(record: BackgroundRecord): SavedRecord {
  return {
    description: record.description,
    prompt: record.prompt,
    status: record.status,
    output: record.output,
    ...(record.error === undefined ? {} : { error: record.error }),
    waiter: record.waiter,
  }
}

function snapshot(record: BackgroundRecord): ClaudeBackgroundSnapshot {
  return {
    id: record.id,
    description: record.description,
    prompt: record.prompt,
    status: record.status,
    output: record.output,
    ...(record.error === undefined ? {} : { error: record.error }),
  }
}

/** Track DSH lifecycle events under the task vocabulary emitted by Claude Code. */
export class ClaudeBackgroundTasks {
  private readonly records = new Map<string, BackgroundRecord>()

  /** Subscribe before any Agent call so fast subagents cannot finish before registration. */
  constructor(ctx: Context) {
    ctx.on('subagent/start', info => this.observeStart(info))
    ctx.on('subagent/end', info => this.observeEnd(info))
  }

  private make(id: string, status: ClaudeBackgroundStatus): BackgroundRecord {
    const record: BackgroundRecord = {
      id,
      description: id,
      prompt: '',
      status,
      output: '',
      waiter: waiter(),
    }
    this.records.set(id, record)
    return record
  }

  /** Apply one DSH subagent/start event to the Claude task projection. */
  observeStart(info: SubagentRunInfo): void {
    const id = String(info.id)
    const record = this.records.get(id) ?? this.make(id, 'running')
    if (record.status !== 'pending' && record.status !== 'running') record.waiter = waiter()
    record.status = 'running'
    record.output = ''
    delete record.error
  }

  /** Apply one DSH subagent/end event to the Claude task projection. */
  observeEnd(info: SubagentRunEndInfo): void {
    const id = String(info.id)
    const record = this.records.get(id) ?? this.make(id, 'running')
    const outcome = terminalStatus(info)
    record.status = outcome.status
    record.output = textContent(info.lastAssistantMessage)
    if (outcome.error === undefined) delete record.error
    else record.error = outcome.error
    record.waiter.resolve()
  }

  /** Attach Claude's launch metadata without overwriting an event observed first. */
  register(id: string, description: string, prompt: string): ClaudeBackgroundSnapshot {
    const record = this.records.get(id) ?? this.make(id, 'running')
    record.description = description
    record.prompt = prompt
    return snapshot(record)
  }

  /** Read a known continuable subagent without mutating its lifecycle. */
  get(id: string): ClaudeBackgroundSnapshot | undefined {
    const record = this.records.get(id)
    return record === undefined ? undefined : snapshot(record)
  }

  /** Project a successfully requested interruption immediately. */
  markKilled(id: string): void {
    const record = this.records.get(id)
    if (record === undefined) return
    record.status = 'killed'
    record.error = 'Subagent was interrupted'
    record.waiter.resolve()
  }

  /** Reserve a new completion epoch before dispatching SendMessage. */
  prepareTurn(id: string): PreparedBackgroundTurn | undefined {
    const record = this.records.get(id)
    if (record === undefined) return undefined
    const before = saved(record)
    const activeWaiter = waiter()
    record.status = 'pending'
    record.output = ''
    delete record.error
    record.waiter = activeWaiter
    return {
      previousStatus: before.status,
      rollback: () => {
        if (record.waiter !== activeWaiter || record.status !== 'pending') return
        record.description = before.description
        record.prompt = before.prompt
        record.status = before.status
        record.output = before.output
        if (before.error === undefined) delete record.error
        else record.error = before.error
        record.waiter = before.waiter
      },
    }
  }

  /** Wait until the current epoch settles or the requested timeout expires. */
  async wait(id: string, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
    const record = this.records.get(id)
    if (record === undefined) throw new Error(`No task found with ID: ${id}`)
    if (record.status !== 'pending' && record.status !== 'running') return true
    signal.throwIfAborted()
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: (() => void) | undefined
    try {
      return await Promise.race([
        record.waiter.promise.then(() => true),
        new Promise<boolean>(resolve => {
          timer = setTimeout(() => resolve(false), timeoutMs)
        }),
        new Promise<boolean>((_resolve, reject) => {
          abort = () => reject(signal.reason)
          signal.addEventListener('abort', abort, { once: true })
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (abort !== undefined) signal.removeEventListener('abort', abort)
    }
  }
}
