/** Claude workflow-script parsing and DSH workflow argument translation. */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parse, type Node } from 'acorn'
import type { JsonValue } from '@deepseek-ai/dsh-tools'

interface AstNode extends Node {
  readonly type: string
  readonly [key: string]: unknown
}

interface ParsedWorkflow {
  readonly script: string
  readonly meta: Record<string, JsonValue>
}

function node(value: unknown, description: string): AstNode {
  if (typeof value !== 'object' || value === null || typeof (value as { type?: unknown }).type !== 'string') {
    throw new Error(`Workflow ${description} is malformed`)
  }
  return value as AstNode
}

function nodes(value: unknown, description: string): AstNode[] {
  if (!Array.isArray(value)) throw new Error(`Workflow ${description} is malformed`)
  return value.map(item => node(item, description))
}

function propertyName(property: AstNode): string {
  if (property.computed === true || property.kind !== 'init' || property.method === true) {
    throw new Error('Workflow meta must be a pure object literal without computed keys or methods')
  }
  const key = node(property.key, 'meta property key')
  if (key.type === 'Identifier' && typeof key.name === 'string') return key.name
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value
  throw new Error('Workflow meta object keys must be identifiers or string literals')
}

function pureLiteral(value: unknown, location = 'meta'): JsonValue {
  const current = node(value, location)
  switch (current.type) {
    case 'Literal': {
      const literal = current.value
      if (literal === null || typeof literal === 'string' || typeof literal === 'boolean') return literal
      if (typeof literal === 'number' && Number.isFinite(literal)) return literal
      throw new Error(`Workflow ${location} contains a non-JSON literal`)
    }
    case 'UnaryExpression': {
      if ((current.operator !== '-' && current.operator !== '+') || current.prefix !== true) {
        throw new Error(`Workflow ${location} contains a non-literal expression`)
      }
      const argument = pureLiteral(current.argument, location)
      if (typeof argument !== 'number') throw new Error(`Workflow ${location} has a non-numeric unary literal`)
      return current.operator === '-' ? -argument : argument
    }
    case 'TemplateLiteral': {
      const expressions = Array.isArray(current.expressions) ? current.expressions : []
      const quasis = Array.isArray(current.quasis) ? current.quasis : []
      if (expressions.length !== 0 || quasis.length !== 1) {
        throw new Error(`Workflow ${location} may not interpolate template values`)
      }
      const quasi = node(quasis[0], location)
      if (typeof quasi.value !== 'object' || quasi.value === null) throw new Error(`Workflow ${location} template is malformed`)
      const cooked = (quasi.value as { cooked?: unknown }).cooked
      if (typeof cooked !== 'string') throw new Error(`Workflow ${location} template is malformed`)
      return cooked
    }
    case 'ArrayExpression': {
      if (!Array.isArray(current.elements)) throw new Error(`Workflow ${location} array is malformed`)
      return current.elements.map((item, index) => {
        if (item === null) throw new Error(`Workflow ${location}[${index}] may not be an array hole`)
        return pureLiteral(item, `${location}[${index}]`)
      })
    }
    case 'ObjectExpression': {
      const result: Record<string, JsonValue> = {}
      for (const property of nodes(current.properties, `${location} properties`)) {
        if (property.type !== 'Property') throw new Error(`Workflow ${location} may not contain spreads`)
        const key = propertyName(property)
        if (Object.hasOwn(result, key)) throw new Error(`Workflow ${location} repeats property ${JSON.stringify(key)}`)
        result[key] = pureLiteral(property.value, `${location}.${key}`)
      }
      return result
    }
    default:
      throw new Error(`Workflow ${location} must be a pure JSON-compatible literal`)
  }
}

/** Extract Claude Code's leading `export const meta` statement and plain script body. */
export function parseClaudeWorkflowScript(source: string): ParsedWorkflow {
  let program: AstNode
  try {
    program = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    }) as unknown as AstNode
  } catch (error: unknown) {
    throw new Error(`Workflow script does not parse: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  const statements = nodes(program.body, 'program body')
  const first = statements[0]
  if (first?.type !== 'ExportNamedDeclaration') {
    throw new Error('Workflow script must begin with `export const meta = {...}`')
  }
  const declaration = node(first.declaration, 'meta declaration')
  if (declaration.type !== 'VariableDeclaration' || declaration.kind !== 'const') {
    throw new Error('Workflow script must begin with `export const meta = {...}`')
  }
  const declarations = nodes(declaration.declarations, 'meta declarations')
  if (declarations.length !== 1) throw new Error('Workflow meta declaration must declare only `meta`')
  const binding = declarations[0]
  if (binding?.type !== 'VariableDeclarator') throw new Error('Workflow meta declaration is malformed')
  const identifier = node(binding.id, 'meta binding')
  if (identifier.type !== 'Identifier' || identifier.name !== 'meta') {
    throw new Error('Workflow script must begin with `export const meta = {...}`')
  }
  const meta = pureLiteral(binding.init)
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    throw new Error('Workflow meta must be an object literal')
  }
  if (typeof meta.name !== 'string' || meta.name.trim().length === 0) {
    throw new Error('Workflow meta.name must be a non-empty string')
  }
  if (typeof meta.description !== 'string' || meta.description.trim().length === 0) {
    throw new Error('Workflow meta.description must be a non-empty string')
  }
  const script = source.slice(first.end).trimStart()
  if (script.length === 0) throw new Error('Workflow script body is empty')
  return { meta, script }
}

async function namedWorkflow(cwd: string, name: string): Promise<string> {
  if (!/^[A-Za-z0-9._-]+$/u.test(name) || name.includes('..')) {
    throw new Error(`Invalid workflow name: ${name}`)
  }
  const candidates = [
    resolve(cwd, '.claude', 'workflows', `${name}.js`),
    resolve(cwd, '.claude', 'workflows', `${name}.mjs`),
  ]
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      // A missing candidate delegates to the next supported extension.
    }
  }
  throw new Error(`Unknown workflow: ${name}`)
}

/** Resolve an inline, path-backed, or named Claude workflow into DSH arguments. */
export async function resolveClaudeWorkflow(
  args: Readonly<Record<string, unknown>>,
  cwd: string,
): Promise<ParsedWorkflow> {
  let source: string
  if (typeof args.scriptPath === 'string') {
    source = await readFile(resolve(cwd, args.scriptPath), 'utf8')
  } else if (typeof args.script === 'string') {
    source = args.script
  } else if (typeof args.name === 'string') {
    source = await namedWorkflow(cwd, args.name)
  } else {
    throw new Error('Workflow requires script, scriptPath, or name')
  }
  return parseClaudeWorkflowScript(source)
}
