/** Git worktree lifecycle compatible with Claude Code's Enter/ExitWorktree tools. */

import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import {
  dispatchNative,
  optionalBooleanArg,
  optionalStringArg,
  stringArg,
  type ClaudeToolBody,
} from './runtime.ts'
import type { ClaudeWorkspace } from './workspace.ts'

interface WorktreeState {
  readonly originalCwd: string
  readonly path: string
  readonly branch: string
  readonly originalHead: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function sessionKey(exec: Parameters<ClaudeToolBody>[1]): string {
  return exec.agent === undefined ? '<unscoped>' : String(exec.agent.session.id)
}

function stdout(value: JsonValue): string {
  if (!isRecord(value) || !isRecord(value.stdout)) return ''
  return String(value.stdout.text ?? '').trim()
}

async function git(
  ctx: Context,
  cwd: string,
  command: string,
  description: string,
  exec: Parameters<ClaudeToolBody>[1],
  suffix: string,
): Promise<string> {
  const value = await dispatchNative(ctx, 'bash', {
    command: `git -C ${shellQuote(cwd)} ${command}`,
    description,
  }, exec, suffix)
  if (isRecord(value) && typeof value.exitCode === 'number' && value.exitCode !== 0) {
    throw new Error(stdout(value) || `git exited with code ${value.exitCode}`)
  }
  return stdout(value)
}

/** Stateful worktree implementation. */
export class WorktreeTools {
  private readonly active = new Map<string, WorktreeState>()

  /** Bind worktree lifecycle to the shared compatibility-tool cwd. */
  constructor(private readonly workspace: ClaudeWorkspace) {}

  /** Create EnterWorktree and ExitWorktree bodies. */
  bodies(ctx: Context): Record<string, ClaudeToolBody> {
    return {
      EnterWorktree: async (args, exec) => {
        const key = sessionKey(exec)
        if (this.active.has(key)) throw new Error('Already in a worktree session')
        const cwd = exec.agent?.session.header.cwd ?? process.cwd()
        const root = await git(ctx, cwd, 'rev-parse --show-toplevel', 'Find git repository root', exec, 'worktree-root')
        if (root.length === 0) throw new Error('EnterWorktree requires a git repository')
        const rawName = optionalStringArg(args, 'name') ?? `worktree-${randomBytes(4).toString('hex')}`
        if (!/^[A-Za-z0-9._/-]{1,64}$/u.test(rawName) || rawName.includes('..')) {
          throw new Error('Worktree name may contain only letters, digits, dots, underscores, dashes, and slashes')
        }
        const branch = `claude/${rawName.replaceAll('/', '-')}`
        const requestedPath = optionalStringArg(args, 'path') ?? resolve('.claude', 'worktrees', rawName)
        const path = resolve(root, requestedPath)
        const originalHead = await git(ctx, root, 'rev-parse HEAD', 'Read current git commit', exec, 'worktree-head')
        await git(
          ctx,
          root,
          `worktree add -b ${shellQuote(branch)} ${shellQuote(path)} ${shellQuote(originalHead)}`,
          `Create worktree ${rawName}`,
          exec,
          'worktree-add',
        )
        this.active.set(key, { originalCwd: cwd, path, branch, originalHead })
        this.workspace.enter(exec, path)
        return `Created worktree at ${path} on branch ${branch}. The session worktree is ready. Use ExitWorktree to leave mid-session.`
      },

      ExitWorktree: async (args, exec) => {
        const key = sessionKey(exec)
        const state = this.active.get(key)
        if (state === undefined) {
          throw new Error('No-op: there is no active EnterWorktree session to exit. This tool only operates on worktrees created by EnterWorktree in the current session — it will not touch worktrees created manually or in a previous session. No filesystem changes were made.')
        }
        const action = stringArg(args, 'action')
        if (action === 'keep') {
          this.active.delete(key)
          this.workspace.leave(exec)
          return `Exited worktree. Your work is preserved at ${state.path} on branch ${state.branch}. Session is now back in ${state.originalCwd}.`
        }
        const changed = (await git(ctx, state.path, 'status --porcelain', 'Check worktree changes', exec, 'worktree-status'))
          .split(/\r?\n/u).filter(Boolean).length
        const commitsText = await git(ctx, state.path, `rev-list --count ${shellQuote(`${state.originalHead}..HEAD`)}`, 'Count worktree commits', exec, 'worktree-commits')
        const commits = Number.parseInt(commitsText, 10) || 0
        if ((changed > 0 || commits > 0) && optionalBooleanArg(args, 'discard_changes') !== true) {
          throw new Error(`Worktree has ${changed} uncommitted file${changed === 1 ? '' : 's'} and ${commits} commit${commits === 1 ? '' : 's'}. Removing will discard this work permanently. Confirm with the user, then re-invoke with discard_changes: true — or use action: "keep" to preserve the worktree.`)
        }
        await git(ctx, state.originalCwd, `worktree remove --force ${shellQuote(state.path)}`, 'Remove worktree', exec, 'worktree-remove')
        await git(ctx, state.originalCwd, `branch -D ${shellQuote(state.branch)}`, 'Delete worktree branch', exec, 'worktree-branch-delete')
        this.active.delete(key)
        this.workspace.leave(exec)
        const discarded: string[] = []
        if (commits > 0) discarded.push(`${commits} ${commits === 1 ? 'commit' : 'commits'}`)
        if (changed > 0) discarded.push(`${changed} uncommitted ${changed === 1 ? 'file' : 'files'}`)
        const note = discarded.length === 0 ? '' : ` Discarded ${discarded.join(' and ')}.`
        return `Exited and removed worktree at ${state.path}.${note} Session is now back in ${state.originalCwd}.`
      },
    }
  }
}
