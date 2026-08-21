/** Host-owned configuration for the Claude Code compatibility surface. */
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import z from '@deepseek-ai/schemastery';
const DEFAULT_WEB_FETCH_MAX_TOKENS = 4_096;
const DEFAULT_DESIGN_ROOT = '.dsh/claude-design-projects';
const DEFAULT_ONBOARDING_ROOT = '.dsh/claude-onboarding-guides';
/** Runtime validation for the host plugin configuration. */
export const Config = z.object({
    webFetchMaxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_WEB_FETCH_MAX_TOKENS),
    timeZone: z.string(),
    designRoot: z.string().default(DEFAULT_DESIGN_ROOT),
    onboardingRoot: z.string().default(DEFAULT_ONBOARDING_ROOT),
    loadClaudeInstructions: z.boolean().default(true),
    claudeConfigDir: z.string(),
});
function positiveInteger(value, fallback, field) {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved <= 0) {
        throw new Error(`dsh-claude-code: ${field} must be a positive safe integer`);
    }
    return resolved;
}
/** Resolve every optional host setting and reject programmatic invalid input. */
export function resolveConfig(config = {}) {
    if (config.timeZone !== undefined) {
        try {
            new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone }).format();
        }
        catch (error) {
            throw new Error(`dsh-claude-code: invalid timeZone ${JSON.stringify(config.timeZone)}`, { cause: error });
        }
    }
    return {
        webFetchMaxTokens: positiveInteger(config.webFetchMaxTokens, DEFAULT_WEB_FETCH_MAX_TOKENS, 'webFetchMaxTokens'),
        designRoot: resolve(config.designRoot ?? DEFAULT_DESIGN_ROOT),
        onboardingRoot: resolve(config.onboardingRoot ?? DEFAULT_ONBOARDING_ROOT),
        loadClaudeInstructions: config.loadClaudeInstructions ?? true,
        claudeConfigDir: resolve(config.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR ?? resolve(homedir(), '.claude')),
        ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
    };
}
//# sourceMappingURL=config.js.map