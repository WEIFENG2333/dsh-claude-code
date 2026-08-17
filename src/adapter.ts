/** Anthropic Messages transport matching the captured Claude Code request. */

import { EventSourceParserStream } from 'eventsource-parser/stream'
import {
  attributionHeaders,
  CallId,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  FinishReason,
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  StreamChunk,
  TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { CLAUDE_CODE_BASELINE } from './generated/claude-code-baseline.ts'
import {
  buildAuxiliaryRequest,
  buildClaudeRequest,
  type ClaudeRequestConfig,
} from './request.ts'

/** Fully resolved adapter settings for one request. */
export interface ClaudeAdapterConfig extends ClaudeRequestConfig {
  readonly provider: string
  readonly baseURL: string
  readonly contextWindow: number
  readonly requestTimeoutMs: number
}

/** Constructor dependencies kept outside the transport. */
export interface ClaudeAdapterOptions {
  readonly config: () => ClaudeAdapterConfig
  readonly resolveApiKey: () => Promise<string>
}

type WireContentBlock = Record<string, unknown> & { type: string }

interface OpenBlock {
  readonly wireIndex: number
  readonly wire: WireContentBlock
  dshIndex?: number
  text: string
  arguments: string
}

interface StreamState {
  readonly blocks: Map<number, OpenBlock>
  readonly nativeContent: WireContentBlock[]
  nextDshIndex: number
  usage: TokenUsage | undefined
  finishReason: FinishReason | undefined
  responseId: string | undefined
  responseModel: string | undefined
  stopped: boolean
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'].map(value => ({
  id: ReasoningEffortId(value),
  name: value,
}))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function wireUsage(value: unknown): TokenUsage | undefined {
  if (!isRecord(value)) return undefined
  const inputTokens = asNumber(value.input_tokens)
  const outputTokens = asNumber(value.output_tokens)
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  const cacheReadTokens = asNumber(value.cache_read_input_tokens)
  const cacheWriteTokens = asNumber(value.cache_creation_input_tokens)
  return {
    inputTokens,
    outputTokens,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
  }
}

function finishReason(reason: unknown): FinishReason | undefined {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return { kind: 'stop' }
    case 'tool_use':
      return { kind: 'tool-calls' }
    case 'max_tokens':
      return { kind: 'max-tokens' }
    case null:
    case undefined:
      return undefined
    default:
      return {
        kind: 'error',
        failure: { message: `model stopped: ${String(reason)}`, code: String(reason).toUpperCase() },
      }
  }
}

function httpErrorCode(status: number): string {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400) return 'INVALID_REQUEST'
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}

function openDshBlock(block: OpenBlock, state: StreamState): StreamChunk {
  if (block.dshIndex !== undefined) throw new Error(`wire block ${block.wireIndex} opened twice`)
  const index = state.nextDshIndex
  state.nextDshIndex += 1
  block.dshIndex = index
  const blockType = block.wire.type === 'thinking'
    ? 'reasoning'
    : block.wire.type === 'tool_use' ? 'tool-call' : 'text'
  return { type: 'block-start', index, blockType }
}

function closeDshBlock(block: OpenBlock): ContentBlock | undefined {
  if (block.dshIndex === undefined) return undefined
  switch (block.wire.type) {
    case 'thinking':
      return { type: 'reasoning', text: block.text }
    case 'text':
      return { type: 'text', text: block.text }
    case 'tool_use':
      return {
        type: 'tool-call',
        id: CallId(asString(block.wire.id) ?? ''),
        name: asString(block.wire.name) ?? '',
        arguments: block.arguments,
      }
    default:
      return undefined
  }
}

function finalizeNativeBlock(block: OpenBlock): void {
  switch (block.wire.type) {
    case 'thinking':
      block.wire.thinking = block.text
      break
    case 'text':
      block.wire.text = block.text
      break
    case 'tool_use':
      try {
        block.wire.input = block.arguments.length === 0 ? {} : JSON.parse(block.arguments)
      } catch (error: unknown) {
        throw new LlmError(`malformed tool input for ${String(block.wire.name ?? '')}`, 'MALFORMED_RESPONSE', { cause: error })
      }
      break
  }
}

async function* translateEvent(data: unknown, state: StreamState): AsyncGenerator<StreamChunk> {
  if (!isRecord(data)) throw new LlmError('Anthropic SSE event is not an object', 'MALFORMED_RESPONSE')
  switch (data.type) {
    case 'ping':
      return
    case 'message_start': {
      if (!isRecord(data.message)) throw new LlmError('message_start is missing message', 'MALFORMED_RESPONSE')
      state.responseId = asString(data.message.id)
      state.responseModel = asString(data.message.model)
      state.usage = wireUsage(data.message.usage) ?? state.usage
      return
    }
    case 'content_block_start': {
      const wireIndex = asNumber(data.index)
      if (wireIndex === undefined || !isRecord(data.content_block) || typeof data.content_block.type !== 'string') {
        throw new LlmError('content_block_start is malformed', 'MALFORMED_RESPONSE')
      }
      const wire = structuredClone(data.content_block) as WireContentBlock
      const block: OpenBlock = {
        wireIndex,
        wire,
        text: asString(wire.thinking) ?? asString(wire.text) ?? '',
        arguments: wire.type === 'tool_use' && isRecord(wire.input) && Object.keys(wire.input).length > 0
          ? JSON.stringify(wire.input)
          : '',
      }
      state.blocks.set(wireIndex, block)
      state.nativeContent[wireIndex] = wire
      if (wire.type === 'text' || wire.type === 'tool_use') {
        yield openDshBlock(block, state)
        if (wire.type === 'tool_use') {
          yield {
            type: 'tool-call-delta',
            index: block.dshIndex!,
            id: CallId(asString(wire.id) ?? ''),
            name: asString(wire.name) ?? '',
            argumentsDelta: block.arguments,
          }
        }
      }
      return
    }
    case 'content_block_delta': {
      const wireIndex = asNumber(data.index)
      const block = wireIndex === undefined ? undefined : state.blocks.get(wireIndex)
      if (block === undefined || !isRecord(data.delta)) {
        throw new LlmError('content_block_delta references no open block', 'MALFORMED_RESPONSE')
      }
      switch (data.delta.type) {
        case 'text_delta': {
          const text = asString(data.delta.text) ?? ''
          block.text += text
          yield { type: 'text-delta', index: block.dshIndex!, text }
          return
        }
        case 'thinking_delta': {
          const text = asString(data.delta.thinking) ?? ''
          if (block.dshIndex === undefined) yield openDshBlock(block, state)
          block.text += text
          yield { type: 'reasoning-delta', index: block.dshIndex!, text }
          return
        }
        case 'signature_delta':
          block.wire.signature = asString(data.delta.signature) ?? ''
          return
        case 'input_json_delta': {
          const fragment = asString(data.delta.partial_json) ?? ''
          block.arguments += fragment
          yield {
            type: 'tool-call-delta',
            index: block.dshIndex!,
            id: CallId(asString(block.wire.id) ?? ''),
            argumentsDelta: fragment,
          }
          return
        }
        default:
          return
      }
    }
    case 'content_block_stop': {
      const wireIndex = asNumber(data.index)
      const block = wireIndex === undefined ? undefined : state.blocks.get(wireIndex)
      if (block === undefined) throw new LlmError('content_block_stop references no open block', 'MALFORMED_RESPONSE')
      finalizeNativeBlock(block)
      const closed = closeDshBlock(block)
      if (closed !== undefined) yield { type: 'block-end', index: block.dshIndex!, block: closed }
      state.blocks.delete(block.wireIndex)
      return
    }
    case 'message_delta':
      if (isRecord(data.delta)) state.finishReason = finishReason(data.delta.stop_reason) ?? state.finishReason
      state.usage = wireUsage(data.usage) ?? state.usage
      return
    case 'message_stop': {
      for (const block of state.blocks.values()) {
        finalizeNativeBlock(block)
        const closed = closeDshBlock(block)
        if (closed !== undefined) yield { type: 'block-end', index: block.dshIndex!, block: closed }
      }
      state.blocks.clear()
      if (state.usage !== undefined) yield { type: 'usage', usage: state.usage }
      state.stopped = true
      yield {
        type: 'finish',
        reason: state.finishReason ?? (state.nextDshIndex === 0
          ? { kind: 'error', failure: { message: 'model returned no content', code: 'EMPTY_RESPONSE' } }
          : { kind: 'stop' }),
        replayState: {
          response: {
            protocol: 'anthropic-messages',
            content: state.nativeContent,
            ...(state.responseId === undefined ? {} : { id: state.responseId }),
            ...(state.responseModel === undefined ? {} : { model: state.responseModel }),
          },
        },
      }
      return
    }
    case 'error': {
      const error = isRecord(data.error) ? data.error : undefined
      throw new LlmError(asString(error?.message) ?? 'Anthropic stream error', 'SERVER')
    }
    default:
      return
  }
}

/** Direct-fetch adapter for DeepSeek's Anthropic-compatible endpoint. */
export class ClaudeCodeAdapter extends LlmAdapter {
  constructor(private readonly options: ClaudeAdapterOptions) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'DeepSeek Claude Code compatibility' }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const config = this.options.config()
    return Promise.resolve([{ provider, id: config.model, name: config.model, inputModalities: ['text'] }])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const config = this.options.config()
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      inputModalities: ['text'],
      context: { contextWindow: config.contextWindow },
      defaultMaxTokens: config.maxTokens,
      reasoning: {
        efforts: EFFORTS,
        defaultEffort: ReasoningEffortId(config.effort),
      },
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const config = this.options.config()
    const apiKey = await this.options.resolveApiKey()
    const built = options.purpose === undefined
      ? await buildClaudeRequest(options, config)
      : buildAuxiliaryRequest(options, config)
    const timeoutSignal = AbortSignal.timeout(config.requestTimeoutMs)
    const signal = options.signal === undefined
      ? timeoutSignal
      : AbortSignal.any([options.signal, timeoutSignal])
    const baseURL = config.baseURL.replace(/\/+$/u, '')
    const headers = {
      ...CLAUDE_CODE_BASELINE.headers,
      ...attributionHeaders(),
      Authorization: `Bearer ${apiKey}`,
      'X-Claude-Code-Session-Id': built.sessionId,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }

    let response: Response
    try {
      response = await fetch(`${baseURL}${CLAUDE_CODE_BASELINE.requestPath}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(built.body),
        signal,
      })
    } catch (error: unknown) {
      if (options.signal?.aborted) throw new LlmError('Claude Code request aborted by caller', 'ABORTED', { cause: error })
      if (timeoutSignal.aborted) throw new LlmError(`Claude Code request timed out after ${config.requestTimeoutMs}ms`, 'TIMEOUT', { cause: error })
      throw new LlmError(`Claude Code request to ${baseURL} failed`, 'TRANSPORT', { cause: error })
    }

    if (!response.ok) {
      let message = `Anthropic-compatible API error (HTTP ${response.status})`
      try {
        const body: unknown = await response.json()
        if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
          message = body.error.message
        }
      } catch {
        // The status remains an actionable failure when a gateway returns non-JSON.
      }
      throw new LlmError(message, httpErrorCode(response.status), { status: response.status })
    }
    if (response.body === null) throw new LlmError('Anthropic-compatible API returned no body', 'EMPTY_RESPONSE')

    const state: StreamState = {
      blocks: new Map(),
      nativeContent: [],
      nextDshIndex: 0,
      usage: undefined,
      finishReason: undefined,
      responseId: undefined,
      responseModel: undefined,
      stopped: false,
    }
    const events = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
    for await (const event of events) {
      let data: unknown
      try {
        data = JSON.parse(event.data)
      } catch (error: unknown) {
        throw new LlmError(`malformed Anthropic SSE payload: ${event.data.slice(0, 120)}`, 'MALFORMED_RESPONSE', { cause: error })
      }
      yield* translateEvent(data, state)
      if (state.stopped) return
    }
    throw new LlmError('Anthropic SSE stream ended without message_stop', 'STREAM_CLOSED')
  }
}
