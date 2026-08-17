/** Claude workflow-script parsing and DSH workflow argument translation. */
import type { JsonValue } from '@deepseek-ai/dsh-tools';
interface ParsedWorkflow {
    readonly script: string;
    readonly meta: Record<string, JsonValue>;
}
/** Extract Claude Code's leading `export const meta` statement and plain script body. */
export declare function parseClaudeWorkflowScript(source: string): ParsedWorkflow;
/** Resolve an inline, path-backed, or named Claude workflow into DSH arguments. */
export declare function resolveClaudeWorkflow(args: Readonly<Record<string, unknown>>, cwd: string): Promise<ParsedWorkflow>;
export {};
//# sourceMappingURL=workflow.d.ts.map