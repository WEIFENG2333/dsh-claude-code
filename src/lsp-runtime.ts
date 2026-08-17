/** Optional local LSP composition backed by DSH's stdio capability provider. */

import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import Lsp from '@deepseek-ai/dsh-lsp'
import * as LspStdio from '@deepseek-ai/dsh-lsp-stdio'
import type { LspLocalServerConfig } from '@deepseek-ai/dsh-lsp-stdio'

/** Cordis plugin name. */
export const name = 'claude-code-lsp-provider'

/** Existing DSH services used by the auto-detected stdio providers. */
export const inject = ['fs', 'subprocess']

/** User-supplied stdio language servers keyed by stable provider id. */
export type ClaudeLspServers = Record<string, LspLocalServerConfig>

/** Auto-detection and explicit-server settings for the bundle's LSP provider entry. */
export interface Config {
  autoDetect?: boolean
  servers?: ClaudeLspServers
}

/** Loader validation for the LSP provider entry. */
export const Config: z<Config> = z.object({
  autoDetect: z.boolean().default(true),
  servers: z.dict(z.object({
    command: z.string().required(),
    args: z.array(String).default([]),
    env: z.dict(String).default({}),
    extensionToLanguage: z.dict(String).required(),
  })),
})

const AUTO_SERVERS: ClaudeLspServers = {
  gopls: {
    command: 'gopls',
    extensionToLanguage: { '.go': 'go' },
  },
  'rust-analyzer': {
    command: 'rust-analyzer',
    extensionToLanguage: { '.rs': 'rust' },
  },
  'typescript-language-server': {
    command: 'typescript-language-server',
    args: ['--stdio'],
    extensionToLanguage: {
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.mts': 'typescript',
      '.cts': 'typescript',
    },
  },
  pyright: {
    command: 'pyright-langserver',
    args: ['--stdio'],
    extensionToLanguage: { '.py': 'python', '.pyi': 'python' },
  },
  clangd: {
    command: 'clangd',
    extensionToLanguage: {
      '.c': 'c',
      '.h': 'c',
      '.cc': 'cpp',
      '.cpp': 'cpp',
      '.cxx': 'cpp',
      '.hpp': 'cpp',
    },
  },
}

const COMMON_EXECUTABLES: Readonly<Record<string, readonly string[]>> = {
  gopls: [resolve(homedir(), 'go/bin/gopls')],
  'rust-analyzer': [resolve(homedir(), '.cargo/bin/rust-analyzer')],
  'typescript-language-server': [resolve(homedir(), '.npm-global/bin/typescript-language-server')],
  pyright: [resolve(homedir(), '.local/bin/pyright-langserver')],
  clangd: ['/usr/bin/clangd', '/usr/local/bin/clangd'],
}

async function autoDetectedServers(ctx: Context): Promise<ClaudeLspServers> {
  const resolved = await Promise.all(Object.entries(AUTO_SERVERS).map(async ([id, server]) => {
    for (const command of [server.command, ...(COMMON_EXECUTABLES[id] ?? [])]) {
      try {
        const executable = await ctx.subprocess.resolveExecutable(command, server.env ?? {}, new AbortController().signal)
        return [id, { ...server, command: executable }] as const
      } catch {
        // Try the next conventional installation path for this server.
      }
    }
    return undefined
  }))
  return Object.fromEntries(resolved.filter(entry => entry !== undefined))
}

/** Prefer non-empty explicit server configuration, otherwise run optional auto-detection. */
export async function resolveLspServers(ctx: Context, config: Config): Promise<ClaudeLspServers> {
  const configured = config.servers ?? {}
  if (Object.keys(configured).length > 0) return configured
  return config.autoDetect !== false ? autoDetectedServers(ctx) : {}
}

/** Mount the explicitly configured or auto-detected local providers below the bundle's LSP service. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  new Lsp(ctx)
  const selected = await resolveLspServers(ctx, config)
  if (Object.keys(selected).length === 0) return
  const servers = Object.fromEntries(Object.entries(selected).map(([id, server]) => [id, {
    args: [],
    env: {},
    initializationOptions: null,
    configuration: null,
    maxMessageBytes: 16_000_000,
    maxStderrBytes: 1_000_000,
    maxDocumentBytes: 4_000_000,
    shutdownTimeoutMs: 5_000,
    killGraceMs: 2_000,
    ...server,
  }]))
  await LspStdio.apply(ctx, { servers })
}
