/** Profile-wide Claude Code compatibility surface. */
import { apply as applyAgentSurface } from "./agent.js";
import { Config, resolveConfig } from "./config.js";
/** Cordis plugin name. */
export const name = 'claude-code-compat';
/** The host plugin waits for optional profile-specific services itself. */
export const inject = [];
export { Config, resolveConfig };
/** Install the Claude surface into the DSH profile that loaded this bundle. */
export function apply(ctx, rawConfig = {}) {
    ctx.provide('claudeCodeModeConfig', resolveConfig(rawConfig));
    ctx.inject(['llm', 'tools', 'systemPrompt', 'claudeCodeModeConfig'], (surfaceCtx) => applyAgentSurface(surfaceCtx));
}
//# sourceMappingURL=index.js.map