/** Session-local current-directory projection used by EnterWorktree. */

import { isAbsolute, resolve } from 'node:path'
import type { ClaudeToolBody } from './runtime.ts'

type ToolExecution = Parameters<ClaudeToolBody>[1]

function sessionKey(exec: ToolExecution): string {
  return exec.agent === undefined ? '<unscoped>' : String(exec.agent.session.id)
}

/** Keep relative paths and shell workdirs coherent while a worktree is active. */
export class ClaudeWorkspace {
  private readonly overrides = new Map<string, string>()

  /** Return the effective current directory for one tool execution. */
  cwd(exec: ToolExecution): string {
    return this.overrides.get(sessionKey(exec))
      ?? exec.agent?.session.header.cwd
      ?? process.cwd()
  }

  /** Resolve a model-provided path against the effective current directory. */
  path(exec: ToolExecution, path: string): string {
    return isAbsolute(path) ? path : resolve(this.cwd(exec), path)
  }

  /** Switch subsequent compatibility tools to a newly created worktree. */
  enter(exec: ToolExecution, path: string): void {
    this.overrides.set(sessionKey(exec), path)
  }

  /** Restore subsequent compatibility tools to the DSH session directory. */
  leave(exec: ToolExecution): void {
    this.overrides.delete(sessionKey(exec))
  }
}
