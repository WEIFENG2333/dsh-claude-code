/** Build the Anthropic Messages request emitted by the Claude Code compatibility adapter. */
import type { GenerateOptions, ToolSchema } from '@deepseek-ai/dsh-llm';
type JsonObject = Record<string, unknown>;
/** Runtime-dependent values interpolated into the captured system blocks. */
export interface ClaudeRuntimeEnvironment {
    readonly cwd: string;
    readonly isGit: boolean;
    readonly platform: NodeJS.Platform;
    readonly shell: string;
    readonly osVersion: string;
    readonly model: string;
    readonly memoryDirectory: string;
    readonly gitStatus?: string;
}
/** Materialized Anthropic system blocks plus the DSH prompt projection. */
export interface MaterializedClaudeSystem {
    readonly blocks: readonly JsonObject[];
    readonly prompt: string;
}
/** Resolved request settings owned by the plugin configuration. */
export interface ClaudeRequestConfig {
    readonly model: string;
    readonly maxTokens: number;
    readonly effort: string;
    readonly timeZone?: string;
    readonly claudeConfigPath?: string;
    readonly deviceId?: string;
    readonly accountUuid?: string;
    readonly sessionId?: string;
    /** Startup snapshot used for both DSH assembly and wire serialization. */
    readonly capturedSystem?: MaterializedClaudeSystem;
    /** Claude instruction files captured at session startup. */
    readonly claudeInstructions?: string;
}
/** Request plus the session id also placed in the Claude Code header. */
export interface BuiltClaudeRequest {
    readonly body: JsonObject;
    readonly sessionId: string;
}
/** Capture the startup environment fields Claude Code places in its system prompt. */
export declare function captureRuntimeEnvironment(model?: string, cwd?: string, memoryDirectory?: string): ClaudeRuntimeEnvironment;
/** Materialize the captured system blocks for one immutable startup snapshot. */
export declare function materializeCapturedSystem(environment?: ClaudeRuntimeEnvironment): MaterializedClaudeSystem;
/** Return the captured system prompt as one DSH system string. */
export declare function capturedSystemPrompt(model?: string): string;
/** Return the captured agent catalog message text for the runtime-context log. */
export declare function capturedAgentContext(): string;
/** Render the current-date reminder while preserving every captured byte except the date. */
export declare function currentDateReminder(now?: Date, timeZone?: string, instructions?: string): string;
/** Refuse prompt-cache drift between the registered DSH tools and the captured wire surface. */
export declare function assertCapturedToolSurface(tools: readonly ToolSchema[] | undefined): void;
/** Build the main Claude Code request body in captured key order. */
export declare function buildClaudeRequest(options: GenerateOptions, config: ClaudeRequestConfig): Promise<BuiltClaudeRequest>;
/** Build a minimal auxiliary request for DSH-owned title/compaction calls. */
export declare function buildAuxiliaryRequest(options: GenerateOptions, config: ClaudeRequestConfig): BuiltClaudeRequest;
export {};
//# sourceMappingURL=request.d.ts.map