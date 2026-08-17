/** Compatibility bodies for Claude's optional LSP and MCP-readiness tools. */
import type { Context } from '@deepseek-ai/cordis';
import { type ClaudeToolBody } from './runtime.ts';
import type { ClaudeWorkspace } from './workspace.ts';
/** Build optional-runtime tools without requiring an LSP or MCP server in the base profile. */
export declare function runtimeServiceBodies(ctx: Context, workspace: ClaudeWorkspace): Record<string, ClaudeToolBody>;
//# sourceMappingURL=runtime-services.d.ts.map