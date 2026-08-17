/** Anthropic Messages transport matching the captured Claude Code request. */
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import { type ClaudeRequestConfig } from './request.ts';
/** Fully resolved adapter settings for one request. */
export interface ClaudeAdapterConfig extends ClaudeRequestConfig {
    readonly provider: string;
    readonly baseURL: string;
    readonly contextWindow: number;
    readonly requestTimeoutMs: number;
}
/** Constructor dependencies kept outside the transport. */
export interface ClaudeAdapterOptions {
    readonly config: () => ClaudeAdapterConfig;
    readonly resolveApiKey: () => Promise<string>;
}
/** Direct-fetch adapter for DeepSeek's Anthropic-compatible endpoint. */
export declare class ClaudeCodeAdapter extends LlmAdapter {
    private readonly options;
    constructor(options: ClaudeAdapterOptions);
    providerInfo(provider: string): LlmProviderInfo;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
//# sourceMappingURL=adapter.d.ts.map