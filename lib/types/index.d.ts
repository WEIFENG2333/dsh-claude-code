/** DSH bundle plugin reproducing the captured Claude Code request and tool surface. */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type ClaudeAdapterConfig } from './adapter.ts';
/** Cordis plugin name. */
export declare const name = "claude-code-compat";
/** Required DSH capability seams. */
export declare const inject: string[];
/** Plugin configuration; all request-changing values resolve explicitly at load. */
export interface Config {
    /** DSH provider route registered by this plugin. */
    provider?: string;
    /** Anthropic-compatible API base URL. */
    baseURL?: string;
    /** Credential reference resolved for every request. */
    apiKeyEnv?: string;
    /** Model id sent in the captured request body. */
    model?: string;
    /** Main-request output cap. */
    maxTokens?: number;
    /** Model context capacity advertised to DSH. */
    contextWindow?: number;
    /** Claude Code reasoning effort. */
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    /** Complete transport timeout in milliseconds. */
    requestTimeoutMs?: number;
    /** Output cap for the auxiliary WebFetch question-answering call. */
    webFetchMaxTokens?: number;
    /** IANA time zone used by Claude's current-date reminder. */
    timeZone?: string;
    /** Optional path to the local Claude configuration used to recover its device id. */
    claudeConfigPath?: string;
    /** Explicit Claude metadata device id; normally auto-read from the local Claude install. */
    deviceId?: string;
    /** Optional Claude metadata account UUID. */
    accountUuid?: string;
    /** Fixed session id for deterministic capture tests. */
    sessionId?: string;
    /** Local persistence root for the offline-compatible DesignSync backend. */
    designRoot?: string;
    /** Local persistence root for the ShareOnboardingGuide fallback. */
    onboardingRoot?: string;
    /** Load Claude Code instruction and auto-memory files into the first request. */
    loadClaudeInstructions?: boolean;
    /** Claude configuration directory containing CLAUDE.md, rules, and memory. */
    claudeConfigDir?: string;
}
/** Runtime validation for the plugin configuration. */
export declare const Config: z<Config>;
/** Materialize every default and reject programmatic configurations that bypass Schemastery. */
export declare function resolveConfig(config: Config): ClaudeAdapterConfig & {
    readonly apiKeyEnv: string;
    readonly webFetchMaxTokens: number;
    readonly designRoot: string;
    readonly onboardingRoot: string;
    readonly loadClaudeInstructions: boolean;
    readonly claudeConfigDir: string;
};
/** Register the exact prompt/tool surface and Anthropic-compatible adapter. */
export declare function apply(ctx: Context, rawConfig: Config): void;
//# sourceMappingURL=index.d.ts.map