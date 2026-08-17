/** Claude-compatible filesystem, shell, web, skill, and workflow tool bodies. */
import type { Context } from '@deepseek-ai/cordis';
import { type ClaudeToolBody } from './runtime.ts';
import type { ClaudeWorkspace } from './workspace.ts';
/** Model route used by Claude's prompt-aware WebFetch compatibility call. */
export interface CoreToolOptions {
    readonly provider: string;
    readonly model: string;
    readonly webFetchMaxTokens: number;
    readonly workspace: ClaudeWorkspace;
}
/** Create core tool implementations backed by the shipped DSH tools. */
export declare function coreToolBodies(ctx: Context, options: CoreToolOptions): Record<string, ClaudeToolBody>;
//# sourceMappingURL=core.d.ts.map