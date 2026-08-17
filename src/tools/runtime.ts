/** Shared registration, validation, and nested-dispatch helpers for Claude-facing tools. */

import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import type { Context } from '@deepseek-ai/cordis'
import { CallId, HarnessError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {
  JsonSchemaNode,
  JsonValue,
  ToolDefinition,
  ToolExecutionResult,
  ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import { CLAUDE_CODE_BASELINE } from '../generated/claude-code-baseline.ts'

/** One captured Claude Code tool definition. */
export type CapturedTool = (typeof CLAUDE_CODE_BASELINE.tools)[number]

/** A validated Claude-facing tool body. */
export type ClaudeToolBody = (
  args: Readonly<Record<string, unknown>>,
  exec: ToolRunContext,
) => Promise<JsonValue>

const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })

class ClaudeInputValidationError extends HarnessError {
  constructor(message: string) {
    super(`InputValidationError: ${message}`, 'INVALID_ARGS')
    this.name = 'ClaudeInputValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validationMessage(errors: ErrorObject[] | null | undefined): string {
  if (errors === null || errors === undefined || errors.length === 0) return 'invalid input'
  return errors.map(error => {
    const location = error.instancePath.length === 0 ? 'input' : `input${error.instancePath}`
    return `${location} ${error.message ?? 'is invalid'}`
  }).join('; ')
}

const validators = new Map<string, ValidateFunction>()

function validate(tool: CapturedTool, args: unknown): asserts args is Record<string, unknown> {
  let validator = validators.get(tool.name)
  if (validator === undefined) {
    validator = ajv.compile(tool.input_schema)
    validators.set(tool.name, validator)
  }
  const compiled = validator
  if (!compiled(args)) throw new ClaudeInputValidationError(validationMessage(compiled.errors))
  if (!isRecord(args)) throw new ClaudeInputValidationError('input must be an object')
}

const SUPPORTED_KEYS = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'title',
  'description',
  'default',
  'deprecated',
  'readOnly',
  'writeOnly',
  'examples',
])

/** Reduce a full draft-2020 schema to DSH's execution-registry subset. */
export function registrySchema(value: unknown): JsonSchemaNode {
  if (!isRecord(value)) return {}
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key === 'anyOf' ? 'oneOf' : key
    if (!SUPPORTED_KEYS.has(normalizedKey)) continue
    switch (normalizedKey) {
      case 'properties':
        result.properties = isRecord(child)
          ? Object.fromEntries(Object.entries(child).map(([name, schema]) => [name, registrySchema(schema)]))
          : {}
        break
      case 'items':
        result.items = registrySchema(child)
        break
      case 'oneOf':
        result.oneOf = Array.isArray(child) ? child.map(registrySchema) : []
        break
      case 'additionalProperties':
        result.additionalProperties = typeof child === 'boolean' ? child : true
        break
      default:
        result[normalizedKey] = structuredClone(child)
    }
  }
  return result as JsonSchemaNode
}

function renderValue(value: JsonValue): ContentBlock[] {
  if (typeof value === 'string') return [{ type: 'text', text: value }]
  if (isRecord(value) && Array.isArray(value.content)) {
    return structuredClone(value.content) as unknown as ContentBlock[]
  }
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function finalizeError(result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined {
  if (!result.isError) return undefined
  return [{ type: 'text', text: `<tool_use_error>${result.error.message}</tool_use_error>` }]
}

/** Construct one executable DSH definition while the prompt listener owns its exact wire schema. */
export function capturedToolDefinition(tool: CapturedTool, body: ClaudeToolBody): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: registrySchema(tool.input_schema) as Record<string, unknown>,
    output: {
      schema: {},
      render: (_args, value) => renderValue(value),
    },
    async execute(args, exec) {
      validate(tool, args)
      return body(args, exec)
    },
    finalizeContent: (_exec, result) => finalizeError(result),
    isConcurrencySafe: () => ['Read', 'TaskGet', 'TaskList', 'ListAgents', 'CronList'].includes(tool.name),
    presentCall: args => ({ card: 'generic', title: tool.name, rawInput: JSON.stringify(args) }),
  }
}

/** Look up one captured tool by its stable name. */
export function capturedTool(name: string): CapturedTool {
  const tool = CLAUDE_CODE_BASELINE.tools.find(candidate => candidate.name === name)
  if (tool === undefined) throw new Error(`captured Claude Code tool ${name} is missing`)
  return tool
}

function nestedFailure(result: Extract<ToolExecutionResult, { isError: true }>): never {
  throw new HarnessError(result.error.message, result.error.info?.code ?? 'NESTED_TOOL_FAILED')
}

/** Dispatch one existing DSH tool through its complete policy and result pipeline. */
export async function dispatchNative(
  ctx: Context,
  name: string,
  args: unknown,
  exec: ToolRunContext,
  suffix = 'native',
): Promise<JsonValue> {
  const result = await dispatchNativeResult(ctx, name, args, exec, suffix)
  if (result.isError) nestedFailure(result)
  return result.value
}

/** Dispatch an existing DSH tool and retain both its canonical value and rendered content. */
export async function dispatchNativeResult(
  ctx: Context,
  name: string,
  args: unknown,
  exec: ToolRunContext,
  suffix = 'native',
): Promise<ToolExecutionResult> {
  const result = await ctx.tools.execute({
    callId: CallId(`${String(exec.callId)}:${suffix}`),
    rootCallId: exec.rootCallId,
    name,
    arguments: args,
    ...(exec.agent === undefined ? {} : { agent: exec.agent }),
    parent: exec.token,
    signal: exec.signal,
  })
  for (const context of result.additionalContexts ?? []) exec.deferContext(context)
  if (result.concludesTurn === true) exec.concludeTurn()
  return result
}

/** Extract text from a nested Native result when no richer projection is needed. */
export function resultText(result: JsonValue): string {
  if (typeof result === 'string') return result
  if (isRecord(result)) {
    if (typeof result.text === 'string') return result.text
    if (Array.isArray(result.content)) {
      return result.content
        .filter((block): block is Record<string, JsonValue> => isRecord(block))
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => String(block.text))
        .join('\n')
    }
  }
  return JSON.stringify(result, null, 2)
}

/** Require a string argument after the captured JSON Schema has run. */
export function stringArg(args: Readonly<Record<string, unknown>>, name: string): string {
  const value = args[name]
  if (typeof value !== 'string') throw new ClaudeInputValidationError(`input/${name} must be string`)
  return value
}

/** Read an optional string argument. */
export function optionalStringArg(args: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = args[name]
  return typeof value === 'string' ? value : undefined
}

/** Read an optional boolean argument. */
export function optionalBooleanArg(args: Readonly<Record<string, unknown>>, name: string): boolean | undefined {
  const value = args[name]
  return typeof value === 'boolean' ? value : undefined
}

/** Read an optional finite number argument. */
export function optionalNumberArg(args: Readonly<Record<string, unknown>>, name: string): number | undefined {
  const value = args[name]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
