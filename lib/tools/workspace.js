/** Session-local current-directory projection used by EnterWorktree. */
import { isAbsolute, resolve } from 'node:path';
function sessionKey(exec) {
    return exec.agent === undefined ? '<unscoped>' : String(exec.agent.session.id);
}
/** Keep relative paths and shell workdirs coherent while a worktree is active. */
export class ClaudeWorkspace {
    overrides = new Map();
    /** Return the effective current directory for one tool execution. */
    cwd(exec) {
        return this.overrides.get(sessionKey(exec))
            ?? exec.agent?.session.header.cwd
            ?? process.cwd();
    }
    /** Resolve a model-provided path against the effective current directory. */
    path(exec, path) {
        return isAbsolute(path) ? path : resolve(this.cwd(exec), path);
    }
    /** Switch subsequent compatibility tools to a newly created worktree. */
    enter(exec, path) {
        this.overrides.set(sessionKey(exec), path);
    }
    /** Restore subsequent compatibility tools to the DSH session directory. */
    leave(exec) {
        this.overrides.delete(sessionKey(exec));
    }
}
//# sourceMappingURL=workspace.js.map