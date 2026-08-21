/** Host-plane registration for the independent Claude Code agent mode. */
import { fileURLToPath } from 'node:url';
import { apply as applyAgentSurface } from "./agent.js";
import { Config, resolveConfig } from "./config.js";
/** Cordis plugin name. */
export const name = 'claude-code-mode';
/** The host plugin waits for optional profile-specific services itself. */
export const inject = [];
export { Config, resolveConfig };
const PRESET_ROOT = fileURLToPath(new URL('../presets', import.meta.url));
function presetRegistry(ctx) {
    const service = ctx.get('agentPresets');
    if (typeof service !== 'object'
        || service === null
        || !('registerRoot' in service)
        || typeof service.registerRoot !== 'function') {
        throw new Error('dsh-claude-code: this DSH Web version cannot register plugin-provided agent presets; upgrade DSH');
    }
    return service;
}
/** Register the Web preset and retain the same surface for the headless profile. */
export function apply(ctx, rawConfig = {}) {
    ctx.provide('claudeCodeModeConfig', resolveConfig(rawConfig));
    ctx.inject(['agentPresets'], (presetCtx) => {
        presetRegistry(presetCtx).registerRoot({ id: 'dsh-claude-code', path: PRESET_ROOT });
    });
    ctx.inject(['headlessStartup', 'llm', 'tools', 'systemPrompt', 'claudeCodeModeConfig'], (headlessCtx) => applyAgentSurface(headlessCtx));
}
//# sourceMappingURL=index.js.map