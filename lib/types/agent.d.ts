/** Claude Code prompt and tool surface for one installed DSH profile. */
import type { Context } from '@deepseek-ai/cordis';
/** Cordis plugin name. */
export declare const name = "claude-code-agent-surface";
/** DSH capabilities used by the compatibility surface. */
export declare const inject: string[];
/** Register Claude's prompt and tools in the calling profile scope. */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=agent.d.ts.map