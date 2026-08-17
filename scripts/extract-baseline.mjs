import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [tracePath] = process.argv.slice(2).filter(argument => argument !== '--')
if (!tracePath) {
  throw new Error('usage: pnpm baseline:extract -- <claude-tap-trace.jsonl>')
}

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
}

function replaceRequired(value, pattern, replacement, description) {
  if (!pattern.test(value)) throw new Error(`cannot locate ${description} in captured system prompt`)
  return value.replace(pattern, replacement)
}

function templateSystem(system, model) {
  const result = structuredClone(system)
  const environmentBlock = result.at(-1)
  if (typeof environmentBlock?.text !== 'string') {
    throw new Error('captured system prompt has no environment block')
  }

  let text = environmentBlock.text
  text = replaceRequired(text, /(?<= - Primary working directory: )[^\n]+/u, RUNTIME_TOKENS.cwd, 'working directory')
  text = replaceRequired(text, /(?<= - Is a git repository: )(?:true|false)/u, RUNTIME_TOKENS.isGit, 'git repository flag')
  text = replaceRequired(text, /(?<= - Platform: )[^\n]+/u, RUNTIME_TOKENS.platform, 'platform')
  text = replaceRequired(text, /(?<= - Shell: )[^\n]+/u, RUNTIME_TOKENS.shell, 'shell')
  text = replaceRequired(text, /(?<= - OS Version: )[^\n]+/u, RUNTIME_TOKENS.osVersion, 'OS version')
  text = replaceRequired(
    text,
    new RegExp(`(?<= - You are powered by the model )${model.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?=\\.)`, 'u'),
    RUNTIME_TOKENS.model,
    'model id',
  )
  if (text.includes('# Memory')) {
    text = replaceRequired(
      text,
      /(?<=persistent file-based memory at `)[^`]+(?=`)/u,
      RUNTIME_TOKENS.memoryDirectory,
      'memory directory',
    )
  }
  text = replaceRequired(
    text,
    /\n\ngitStatus: [\s\S]*$/u,
    `\n\n${RUNTIME_TOKENS.gitStatus}`,
    'git status section',
  )
  environmentBlock.text = text
  return result
}

function templateReminder(block) {
  const result = structuredClone(block)
  if (typeof result?.text !== 'string') throw new Error('captured current-date reminder is missing')
  const currentDate = result.text.indexOf('# currentDate\n')
  if (currentDate < 0) throw new Error('captured reminder has no currentDate section')
  const instructions = result.text.lastIndexOf('# claudeMd\n', currentDate)
  result.text = instructions < 0
    ? `${result.text.slice(0, currentDate)}${RUNTIME_TOKENS.instructions}${result.text.slice(currentDate)}`
    : `${result.text.slice(0, instructions)}${RUNTIME_TOKENS.instructions}${result.text.slice(currentDate)}`
  return result
}

const records = (await readFile(resolve(tracePath), 'utf8'))
  .split(/\r?\n/u)
  .filter(Boolean)
  .map(line => JSON.parse(line))
const record = records.find(candidate => Array.isArray(candidate.request?.body?.tools)
  && candidate.request.body.tools.length > 0)
if (!record) throw new Error('trace has no request containing tools')

const body = record.request.body
if (!Array.isArray(body.system) || body.system.length !== 3) {
  throw new Error(`expected three Claude Code system blocks, got ${body.system?.length ?? 'none'}`)
}
if (!Array.isArray(body.messages) || body.messages.length < 2) {
  throw new Error('expected the initial user and system context messages')
}

const firstMessage = body.messages[0]
const agentContextMessage = body.messages[1]
const firstContent = Array.isArray(firstMessage.content) ? firstMessage.content : []
const reminderBlock = firstContent.find(block => block?.type === 'text')
const agentContextBlock = Array.isArray(agentContextMessage.content)
  ? agentContextMessage.content.find(block => block?.type === 'text')
  : undefined
if (typeof reminderBlock?.text !== 'string' || typeof agentContextBlock?.text !== 'string') {
  throw new Error('initial Claude Code context blocks are missing')
}

const billing = body.system[0]?.text
const versionMatch = typeof billing === 'string' ? /cc_version=([^;]+);/u.exec(billing) : null
if (!versionMatch) throw new Error('cannot derive Claude Code version from billing header')

const baseline = {
  capturedVersion: versionMatch[1],
  requestPath: record.request.path,
  system: templateSystem(body.system, body.model),
  tools: body.tools,
  initialContext: {
    currentDateReminderBlock: templateReminder(reminderBlock),
    agentContextMessage,
  },
  defaults: {
    model: body.model,
    maxTokens: body.max_tokens,
    thinking: body.thinking,
    contextManagement: body.context_management,
    outputConfig: body.output_config,
    stream: body.stream,
  },
  headers: Object.fromEntries(Object.entries(record.request.headers ?? {})
    .filter(([name]) => /^(?:anthropic-beta|anthropic-dangerous-direct-browser-access|anthropic-version|x-app)$/iu.test(name))),
}

const outputPath = resolve(root, 'src/generated/claude-code-baseline.ts')
await mkdir(dirname(outputPath), { recursive: true })
const source = `/** Generated from a Claude Tap trace. Run pnpm baseline:extract; do not edit. */\n`
  + `export const CLAUDE_CODE_BASELINE = ${JSON.stringify(baseline, null, 2)} as const\n`
await writeFile(outputPath, source, 'utf8')
console.log(`wrote ${outputPath} (${baseline.tools.length} tools, Claude Code ${baseline.capturedVersion})`)
