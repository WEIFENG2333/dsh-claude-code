/** Host-plane registration for the independent Claude Code agent mode. */
import type { Context } from '@deepseek-ai/cordis';
import { Config, resolveConfig, type PluginConfig } from './config.ts';
/** Cordis plugin name. */
export declare const name = "claude-code-mode";
/** The host plugin waits for optional profile-specific services itself. */
export declare const inject: string[];
export { Config, resolveConfig };
export type { PluginConfig };
/** Register the Web preset and retain the same surface for the headless profile. */
export declare function apply(ctx: Context, rawConfig?: PluginConfig): void;
//# sourceMappingURL=index.d.ts.map