/** Build the Anthropic Messages request emitted by the Claude Code compatibility adapter. */

import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir, hostname, release, type } from 'node:os'
import { resolve } from 'node:path'
import type { ContentBlock, GenerateOptions, Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import { CLAUDE_CODE_BASELINE } from './generated/claude-code-baseline.ts'

type JsonObject = Record<string, unknown>

const MAX_GIT_STATUS_CHARS = 2_000
const RUNTIME_TOKENS = {
  cwd: '{{DSH_CLAUDE_CODE_CWD}}',
  isGit: '{{DSH_CLAUDE_CODE_IS_GIT}}',
  platform: '{{DSH_CLAUDE_CODE_PLATFORM}}',
  shell: '{{DSH_CLAUDE_CODE_SHELL}}',
  osVersion: '{{DSH_CLAUDE_CODE_OS_VERSION}}',
  model: '{{DSH_CLAUDE_CODE_MODEL}}',
  gitStatus: '{{DSH_CLAUDE_CODE_GIT_STATUS}}',
  instructions: '{{DSH_CLAUDE_CODE_INSTRUCTIONS}}',
  memoryDirectory: '{{DSH_CLAUDE_CODE_MEMORY_DIRECTORY}}',
} as const

/** Runtime-dependent values interpolated into the captured system blocks. */
export interface ClaudeRuntimeEnvironment {
  readonly cwd: string
  readonly isGit: boolean
  readonly platform: NodeJS.Platform
  readonly shell: string
  readonly osVersion: string
  readonly model: string
  readonly memoryDirectory: string
  readonly gitStatus?: string
}

/** Materialized Anthropic system blocks plus the DSH prompt projection. */
export interface MaterializedClaudeSystem {
  readonly blocks: readonly JsonObject[]
  readonly prompt: string
}

/** Resolved request settings owned by the plugin configuration. */
export interface ClaudeRequestConfig {
  readonly model: string
  readonly maxTokens: number
  readonly effort: string
  readonly timeZone?: string
  readonly claudeConfigPath?: string
  readonly deviceId?: string
  readonly accountUuid?: string
  readonly sessionId?: string
  /** Startup snapshot used for both DSH assembly and wire serialization. */
  readonly capturedSystem?: MaterializedClaudeSystem
  /** Claude instruction files captured at session startup. */
  readonly claudeInstructions?: string
}

/** Request plus the session id also placed in the Claude Code header. */
export interface BuiltClaudeRequest {
  readonly body: JsonObject
  readonly sessionId: string
}

interface ClaudeReplayState {
  readonly protocol: 'anthropic-messages'
  readonly content: unknown[]
}

interface WireMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: unknown[]
}

function gitOutput(cwd: string, args: readonly string[]): string | undefined {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return result.status === 0 ? result.stdout.trim() : undefined
}

function shellName(): string {
  const shell = process.env.SHELL ?? 'unknown'
  if (shell.includes('zsh')) return 'zsh'
  if (shell.includes('bash')) return 'bash'
  return shell
}

function defaultBranch(cwd: string): string {
  const remote = gitOutput(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  if (remote !== undefined) return remote.replace(/^origin\//u, '')
  return gitOutput(cwd, ['config', '--get', 'init.defaultBranch']) || 'main'
}

function gitStatus(cwd: string, isGit: boolean): string | undefined {
  if (!isGit) return undefined
  const rawStatus = gitOutput(cwd, ['--no-optional-locks', 'status', '--short']) ?? ''
  const status = rawStatus.length > MAX_GIT_STATUS_CHARS
    ? `${rawStatus.slice(0, MAX_GIT_STATUS_CHARS)}\n... (truncated because it exceeds 2k characters. If you need more information, run "git status" using Bash)`
    : rawStatus
  const branch = gitOutput(cwd, ['branch', '--show-current']) ?? ''
  const user = gitOutput(cwd, ['config', 'user.name'])
  const log = gitOutput(cwd, ['--no-optional-locks', 'log', '--oneline', '-n', '5']) ?? ''
  return [
    'This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.',
    `Current branch: ${branch}`,
    `Main branch (you will usually use this for PRs): ${defaultBranch(cwd)}`,
    ...(user === undefined || user.length === 0 ? [] : [`Git user: ${user}`]),
    `Status:\n${status || '(clean)'}`,
    `Recent commits:\n${log}`,
  ].join('\n\n')
}

/** Capture the startup environment fields Claude Code places in its system prompt. */
export function captureRuntimeEnvironment(
  model: string = CLAUDE_CODE_BASELINE.defaults.model,
  cwd = process.cwd(),
  memoryDirectory = resolve(process.env.CLAUDE_CONFIG_DIR ?? resolve(homedir(), '.claude'), 'memory') + '/',
): ClaudeRuntimeEnvironment {
  const isGit = gitOutput(cwd, ['rev-parse', '--is-inside-work-tree']) === 'true'
  const status = gitStatus(cwd, isGit)
  return {
    cwd,
    isGit,
    platform: process.platform,
    shell: shellName(),
    osVersion: `${type()} ${release()}`,
    model,
    memoryDirectory,
    ...(status === undefined ? {} : { gitStatus: status }),
  }
}

function hydrateSystemText(text: string, environment: ClaudeRuntimeEnvironment): string {
  return text
    .replaceAll(RUNTIME_TOKENS.cwd, environment.cwd)
    .replaceAll(RUNTIME_TOKENS.isGit, String(environment.isGit))
    .replaceAll(RUNTIME_TOKENS.platform, environment.platform)
    .replaceAll(RUNTIME_TOKENS.shell, environment.shell)
    .replaceAll(RUNTIME_TOKENS.osVersion, environment.osVersion)
    .replaceAll(RUNTIME_TOKENS.model, environment.model)
    .replaceAll(RUNTIME_TOKENS.memoryDirectory, environment.memoryDirectory)
    .replace(
      `\n\n${RUNTIME_TOKENS.gitStatus}`,
      environment.gitStatus === undefined ? '' : `\n\ngitStatus: ${environment.gitStatus}`,
    )
}

/** Materialize the captured system blocks for one immutable startup snapshot. */
export function materializeCapturedSystem(
  environment = captureRuntimeEnvironment(),
): MaterializedClaudeSystem {
  const blocks = CLAUDE_CODE_BASELINE.system.map(block => ({
    ...clone(block),
    text: hydrateSystemText(block.text, environment),
  }))
  return { blocks, prompt: blocks.map(block => block.text).join('\n\n') }
}

/** Return the captured system prompt as one DSH system string. */
export function capturedSystemPrompt(): string {
  return materializeCapturedSystem().prompt
}

/** Return the captured agent catalog message text for the runtime-context log. */
export function capturedAgentContext(): string {
  const content = CLAUDE_CODE_BASELINE.initialContext.agentContextMessage.content
  const block = content.find(candidate => candidate.type === 'text')
  if (block === undefined) throw new Error('generated Claude Code agent context is missing')
  return block.text
}

/** Render the current-date reminder while preserving every captured byte except the date. */
export function currentDateReminder(
  now = new Date(),
  timeZone?: string,
  instructions?: string,
): string {
  const date = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(now)
  return CLAUDE_CODE_BASELINE.initialContext.currentDateReminderBlock.text
    .replaceAll(
      RUNTIME_TOKENS.instructions,
      instructions === undefined || instructions.length === 0 ? '' : `# claudeMd\n${instructions}\n`,
    )
    .replace(/Today's date is \d{4}-\d{2}-\d{2}\./u, `Today's date is ${date}.`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function toolSurface(tool: ToolSchema): JsonObject {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }
}

/** Refuse prompt-cache drift between the registered DSH tools and the captured wire surface. */
export function assertCapturedToolSurface(tools: readonly ToolSchema[] | undefined): void {
  if (tools === undefined) throw new Error('Claude Code request requires the captured tool surface')
  const actual = tools.map(toolSurface)
  const expected = CLAUDE_CODE_BASELINE.tools
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const actualNames = actual.map(tool => tool.name).join(', ')
    const expectedNames = expected.map(tool => tool.name).join(', ')
    throw new Error(`Claude Code tool surface drifted; expected [${expectedNames}], received [${actualNames}]`)
  }
}

function replayContent(message: Message): unknown[] | undefined {
  if (message.source.kind !== 'model') return undefined
  const envelope = message.source.replayState
  if (!isRecord(envelope) || !isRecord(envelope.response)) return undefined
  const response = envelope.response as Partial<ClaudeReplayState>
  return response.protocol === 'anthropic-messages' && Array.isArray(response.content)
    ? clone(response.content)
    : undefined
}

function parseToolArguments(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson)
  } catch (error: unknown) {
    throw new Error(`cannot replay malformed tool arguments: ${argumentsJson}`, { cause: error })
  }
}

function wireContent(blocks: readonly ContentBlock[], role: 'user' | 'assistant' = 'user'): unknown[] {
  return blocks.flatMap<unknown>(block => {
    switch (block.type) {
      case 'text':
        return [{ type: 'text', text: block.text }]
      case 'reasoning':
        return role === 'assistant'
          ? [{ type: 'thinking', thinking: block.text, signature: '' }]
          : []
      case 'tool-call':
        return [{
          type: 'tool_use',
          id: String(block.id),
          name: block.name,
          input: parseToolArguments(block.arguments),
        }]
      case 'tool-result':
        return [{
          type: 'tool_result',
          tool_use_id: String(block.toolCallId),
          content: wireContent(block.content),
          ...(block.isError === undefined ? {} : { is_error: block.isError }),
        }]
      case 'image':
        throw new Error('Claude Code compatibility adapter cannot resolve DSH image attachments without an attachment provider bridge')
      default:
        throw new Error(`unsupported DSH content block: ${(block as { type: string }).type}`)
    }
  })
}

function appendWireMessage(messages: WireMessage[], message: WireMessage): void {
  const previous = messages.at(-1)
  if (message.role === 'user' && previous?.role === 'user') {
    previous.content.push(...message.content)
    return
  }
  messages.push(message)
}

function initialMessages(options: GenerateOptions, config: ClaudeRequestConfig): WireMessage[] {
  const firstUserIndex = options.messages.findIndex(message => message.source.kind === 'user')
  if (firstUserIndex < 0) throw new Error('Claude Code request requires a user message')
  const firstUser = options.messages[firstUserIndex]
  if (firstUser === undefined) throw new Error('Claude Code request user message disappeared')

  const reminder = {
    ...clone(CLAUDE_CODE_BASELINE.initialContext.currentDateReminderBlock),
    text: currentDateReminder(new Date(), config.timeZone, config.claudeInstructions),
  }
  const agentContext = clone(CLAUDE_CODE_BASELINE.initialContext.agentContextMessage)
  const result: WireMessage[] = [
    { role: 'user', content: [reminder, ...wireContent(firstUser.content)] },
    { role: agentContext.role, content: [...agentContext.content] },
  ]

  for (let index = firstUserIndex + 1; index < options.messages.length; index += 1) {
    const message = options.messages[index]
    if (message === undefined) continue
    const sourceKind: string = message.source.kind
    if (sourceKind === 'plugin' || sourceKind === 'skill-catalog') continue
    if (message.role === 'user') {
      appendWireMessage(result, { role: 'user', content: wireContent(message.content) })
      continue
    }
    if (message.source.kind === 'model') {
      result.push({
        role: 'assistant',
        content: replayContent(message) ?? wireContent(message.content, 'assistant'),
      })
      continue
    }
    if (message.role === 'assistant') {
      result.push({ role: 'assistant', content: wireContent(message.content, 'assistant') })
      continue
    }
    if (message.role === 'system') {
      result.push({ role: 'system', content: wireContent(message.content) })
    }
  }
  return result
}

async function configuredDeviceId(config: ClaudeRequestConfig): Promise<string> {
  if (config.deviceId !== undefined) return config.deviceId
  const path = config.claudeConfigPath ?? resolve(homedir(), '.claude.json')
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (isRecord(parsed) && typeof parsed.userID === 'string' && /^[a-f0-9]{64}$/u.test(parsed.userID)) {
      return parsed.userID
    }
  } catch {
    // Claude Code may not be installed. The deterministic fallback keeps one machine stable.
  }
  return createHash('sha256').update(`dsh-claude-code:${hostname()}`).digest('hex')
}

function requestSessionId(options: GenerateOptions, config: ClaudeRequestConfig): string {
  return config.sessionId ?? (options.sessionId === undefined ? randomUUID() : String(options.sessionId))
}

/** Build the main Claude Code request body in captured key order. */
export async function buildClaudeRequest(
  options: GenerateOptions,
  config: ClaudeRequestConfig,
): Promise<BuiltClaudeRequest> {
  assertCapturedToolSurface(options.tools)
  const capturedSystem = config.capturedSystem ?? materializeCapturedSystem(captureRuntimeEnvironment(config.model))
  if (options.system !== capturedSystem.prompt) {
    throw new Error('Claude Code system prompt drifted before adapter serialization')
  }
  const sessionId = requestSessionId(options, config)
  const userId = JSON.stringify({
    device_id: await configuredDeviceId(config),
    account_uuid: config.accountUuid ?? '',
    session_id: sessionId,
  })
  const body: JsonObject = {
    model: config.model,
    messages: initialMessages(options, config),
    system: clone(capturedSystem.blocks),
    tools: clone(CLAUDE_CODE_BASELINE.tools),
    metadata: { user_id: userId },
    max_tokens: config.maxTokens,
    thinking: clone(CLAUDE_CODE_BASELINE.defaults.thinking),
    context_management: clone(CLAUDE_CODE_BASELINE.defaults.contextManagement),
    output_config: { effort: config.effort },
    stream: true,
  }
  return { body, sessionId }
}

/** Build a minimal auxiliary request for DSH-owned title/compaction calls. */
export function buildAuxiliaryRequest(options: GenerateOptions, config: ClaudeRequestConfig): BuiltClaudeRequest {
  const sessionId = requestSessionId(options, config)
  return {
    sessionId,
    body: {
      model: config.model,
      messages: options.messages.map(message => ({
        role: message.role,
        content: wireContent(message.content, message.role === 'assistant' ? 'assistant' : 'user'),
      })),
      ...(options.system === undefined ? {} : { system: options.system }),
      max_tokens: options.maxTokens ?? config.maxTokens,
      stream: true,
    },
  }
}
