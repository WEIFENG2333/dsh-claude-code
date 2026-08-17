/** Git worktree lifecycle compatible with Claude Code's Enter/ExitWorktree tools. */
import type { Context } from '@deepseek-ai/cordis';
import { type ClaudeToolBody } from './runtime.ts';
import type { ClaudeWorkspace } from './workspace.ts';
/** Stateful worktree implementation. */
export declare class WorktreeTools {
    private readonly workspace;
    private readonly active;
    /** Bind worktree lifecycle to the shared compatibility-tool cwd. */
    constructor(workspace: ClaudeWorkspace);
    /** Create EnterWorktree and ExitWorktree bodies. */
    bodies(ctx: Context): Record<string, ClaudeToolBody>;
}
//# sourceMappingURL=worktree.d.ts.map