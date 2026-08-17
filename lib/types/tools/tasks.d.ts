/** Session-local Claude task list plus adapters for DSH background jobs. */
import type { Context } from '@deepseek-ai/cordis';
import type { ClaudeBackgroundTasks } from './background.ts';
import { type ClaudeToolBody } from './runtime.ts';
/** Mutable task state intentionally scoped to this plugin lifetime and DSH session id. */
export declare class ClaudeTaskStore {
    private readonly background;
    private readonly lists;
    /** Share background-agent lifecycle state with Agent and SendMessage. */
    constructor(background: ClaudeBackgroundTasks);
    private list;
    /** Build the task and job tool bodies sharing this store. */
    bodies(ctx: Context): Record<string, ClaudeToolBody>;
}
//# sourceMappingURL=tasks.d.ts.map