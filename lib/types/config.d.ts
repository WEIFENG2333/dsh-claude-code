/** Host-owned configuration for the Claude Code compatibility surface. */
import z from '@deepseek-ai/schemastery';
/** Plugin configuration. Model and provider selection remain owned by DSH. */
export interface PluginConfig {
    /** Output cap for the auxiliary WebFetch question-answering call. */
    webFetchMaxTokens?: number;
    /** IANA time zone used by Claude's current-date reminder. */
    timeZone?: string;
    /** Local persistence root for the offline-compatible DesignSync backend. */
    designRoot?: string;
    /** Local persistence root for the ShareOnboardingGuide fallback. */
    onboardingRoot?: string;
    /** Load Claude Code instruction and auto-memory files into the first request. */
    loadClaudeInstructions?: boolean;
    /** Claude configuration directory containing CLAUDE.md, rules, and memory. */
    claudeConfigDir?: string;
}
/** Fully resolved settings published by the host plugin. */
export interface ResolvedConfig {
    readonly webFetchMaxTokens: number;
    readonly designRoot: string;
    readonly onboardingRoot: string;
    readonly loadClaudeInstructions: boolean;
    readonly claudeConfigDir: string;
    readonly timeZone?: string;
}
/** Runtime validation for the host plugin configuration. */
export declare const Config: z<PluginConfig>;
/** Resolve every optional host setting and reject programmatic invalid input. */
export declare function resolveConfig(config?: PluginConfig): ResolvedConfig;
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** Host-owned settings consumed by the Claude Code compatibility surface. */
        claudeCodeModeConfig: ResolvedConfig;
    }
}
//# sourceMappingURL=config.d.ts.map