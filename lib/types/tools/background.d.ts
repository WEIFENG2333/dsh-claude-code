/** Claude-style lifecycle projection for DSH continuable subagents. */
import type { Context } from '@deepseek-ai/cordis';
import type { SubagentRunEndInfo, SubagentRunInfo } from '@deepseek-ai/dsh-subagent';
/** Status names exposed by Claude Code's local-agent tasks. */
export type ClaudeBackgroundStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed';
/** Immutable data used by TaskOutput and TaskStop. */
export interface ClaudeBackgroundSnapshot {
    readonly id: string;
    readonly description: string;
    readonly prompt: string;
    readonly status: ClaudeBackgroundStatus;
    readonly output: string;
    readonly error?: string;
}
/** Result of preparing a follow-up turn for one known subagent. */
export interface PreparedBackgroundTurn {
    readonly previousStatus: ClaudeBackgroundStatus;
    /** Restore the preceding projection when native delivery fails. */
    rollback(): void;
}
/** Track DSH lifecycle events under the task vocabulary emitted by Claude Code. */
export declare class ClaudeBackgroundTasks {
    private readonly records;
    /** Subscribe before any Agent call so fast subagents cannot finish before registration. */
    constructor(ctx: Context);
    private make;
    /** Apply one DSH subagent/start event to the Claude task projection. */
    observeStart(info: SubagentRunInfo): void;
    /** Apply one DSH subagent/end event to the Claude task projection. */
    observeEnd(info: SubagentRunEndInfo): void;
    /** Attach Claude's launch metadata without overwriting an event observed first. */
    register(id: string, description: string, prompt: string): ClaudeBackgroundSnapshot;
    /** Read a known continuable subagent without mutating its lifecycle. */
    get(id: string): ClaudeBackgroundSnapshot | undefined;
    /** Project a successfully requested interruption immediately. */
    markKilled(id: string): void;
    /** Reserve a new completion epoch before dispatching SendMessage. */
    prepareTurn(id: string): PreparedBackgroundTurn | undefined;
    /** Wait until the current epoch settles or the requested timeout expires. */
    wait(id: string, timeoutMs: number, signal: AbortSignal): Promise<boolean>;
}
//# sourceMappingURL=background.d.ts.map