/** Session-local current-directory projection used by EnterWorktree. */
import type { ClaudeToolBody } from './runtime.ts';
type ToolExecution = Parameters<ClaudeToolBody>[1];
/** Keep relative paths and shell workdirs coherent while a worktree is active. */
export declare class ClaudeWorkspace {
    private readonly overrides;
    /** Return the effective current directory for one tool execution. */
    cwd(exec: ToolExecution): string;
    /** Resolve a model-provided path against the effective current directory. */
    path(exec: ToolExecution, path: string): string;
    /** Switch subsequent compatibility tools to a newly created worktree. */
    enter(exec: ToolExecution, path: string): void;
    /** Restore subsequent compatibility tools to the DSH session directory. */
    leave(exec: ToolExecution): void;
}
export {};
//# sourceMappingURL=workspace.d.ts.map