/** Profile-wide Claude Code compatibility surface. */
import type { Context } from '@deepseek-ai/cordis';
import { Config, resolveConfig, type PluginConfig } from './config.ts';
/** Cordis plugin name. */
export declare const name = "claude-code-compat";
/** The host plugin waits for optional profile-specific services itself. */
export declare const inject: string[];
export { Config, resolveConfig };
export type { PluginConfig };
/** Install the Claude surface into the DSH profile that loaded this bundle. */
export declare function apply(ctx: Context, rawConfig?: PluginConfig): void;
//# sourceMappingURL=index.d.ts.map