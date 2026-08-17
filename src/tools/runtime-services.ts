/** Compatibility bodies for Claude's optional LSP and MCP-readiness tools. */

import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-lsp'
import type { LspOperation } from '@deepseek-ai/dsh-lsp'
import { formatHover, formatLocations } from '@deepseek-ai/dsh-tool-lsp'
import { optionalNumberArg, stringArg, type ClaudeToolBody } from './runtime.ts'
import type { ClaudeWorkspace } from './workspace.ts'

const NATIVE_LSP_OPERATIONS = new Set([
  'goToDefinition',
  'findReferences',
  'goToImplementation',
  'hover',
])

function isNativeLspOperation(value: string): value is LspOperation {
  return NATIVE_LSP_OPERATIONS.has(value)
}

/** Build optional-runtime tools without requiring an LSP or MCP server in the base profile. */
export function runtimeServiceBodies(
  ctx: Context,
  workspace: ClaudeWorkspace,
): Record<string, ClaudeToolBody> {
  return {
    LSP: async (args, exec) => {
      const operation = stringArg(args, 'operation')
      if (!isNativeLspOperation(operation)) {
        throw new HarnessError(
          `LSP operation ${operation} is unavailable in the configured DSH LSP provider`,
          'LSP_UNSUPPORTED_OPERATION',
        )
      }
      const lsp = ctx.get('lsp')
      if (lsp === undefined) {
        throw new HarnessError(
          'No LSP server is configured for this DSH profile',
          'LSP_UNAVAILABLE',
        )
      }
      const filePath = workspace.path(exec, stringArg(args, 'filePath'))
      const result = await lsp.query({
        operation,
        filePath,
        position: {
          line: (optionalNumberArg(args, 'line') ?? 1) - 1,
          character: (optionalNumberArg(args, 'character') ?? 1) - 1,
        },
        workspaceRoot: workspace.cwd(exec),
      }, exec.signal)
      switch (result.kind) {
        case 'locations':
          return formatLocations(result.locations, result.resolvedWorkspaceUri, 100, 100_000)
        case 'hover':
          return formatHover(result.hover, 100_000)
      }
    },
    WaitForMcpServers: async args => {
      const requested = Array.isArray(args.servers)
        ? args.servers.filter((value): value is string => typeof value === 'string')
        : []
      if (requested.length === 0) {
        return { ready: true, servers: [], message: 'No MCP servers are still connecting.' }
      }
      return {
        ready: false,
        servers: requested.map(name => ({ name, status: 'not_pending' })),
        message: 'DSH MCP clients finish startup discovery before the first model turn; none of the named servers is pending.',
      }
    },
  }
}
