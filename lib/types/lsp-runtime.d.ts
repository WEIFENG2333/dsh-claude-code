/** Optional local LSP composition backed by DSH's stdio capability provider. */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { LspLocalServerConfig } from '@deepseek-ai/dsh-lsp-stdio';
/** Cordis plugin name. */
export declare const name = "claude-code-lsp-provider";
/** Existing DSH services used by the auto-detected stdio providers. */
export declare const inject: string[];
/** User-supplied stdio language servers keyed by stable provider id. */
export type ClaudeLspServers = Record<string, LspLocalServerConfig>;
/** Auto-detection and explicit-server settings for the bundle's LSP provider entry. */
export interface Config {
    autoDetect?: boolean;
    servers?: ClaudeLspServers;
}
/** Loader validation for the LSP provider entry. */
export declare const Config: z<Config>;
/** Prefer non-empty explicit server configuration, otherwise run optional auto-detection. */
export declare function resolveLspServers(ctx: Context, config: Config): Promise<ClaudeLspServers>;
/** Mount the explicitly configured or auto-detected local providers below the bundle's LSP service. */
export declare function apply(ctx: Context, config: Config): Promise<void>;
//# sourceMappingURL=lsp-runtime.d.ts.map