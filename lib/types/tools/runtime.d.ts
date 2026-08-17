/** Shared registration, validation, and nested-dispatch helpers for Claude-facing tools. */
import type { Context } from '@deepseek-ai/cordis';
import type { JsonSchemaNode, JsonValue, ToolDefinition, ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { CLAUDE_CODE_BASELINE } from '../generated/claude-code-baseline.ts';
/** One captured Claude Code tool definition. */
export type CapturedTool = (typeof CLAUDE_CODE_BASELINE.tools)[number];
/** A validated Claude-facing tool body. */
export type ClaudeToolBody = (args: Readonly<Record<string, unknown>>, exec: ToolRunContext) => Promise<JsonValue>;
/** Reduce a full draft-2020 schema to DSH's execution-registry subset. */
export declare function registrySchema(value: unknown): JsonSchemaNode;
/** Construct one executable DSH definition while the prompt listener owns its exact wire schema. */
export declare function capturedToolDefinition(tool: CapturedTool, body: ClaudeToolBody): ToolDefinition;
/** Look up one captured tool by its stable name. */
export declare function capturedTool(name: string): CapturedTool;
/** Dispatch one existing DSH tool through its complete policy and result pipeline. */
export declare function dispatchNative(ctx: Context, name: string, args: unknown, exec: ToolRunContext, suffix?: string): Promise<JsonValue>;
/** Dispatch an existing DSH tool and retain both its canonical value and rendered content. */
export declare function dispatchNativeResult(ctx: Context, name: string, args: unknown, exec: ToolRunContext, suffix?: string): Promise<ToolExecutionResult>;
/** Extract text from a nested Native result when no richer projection is needed. */
export declare function resultText(result: JsonValue): string;
/** Require a string argument after the captured JSON Schema has run. */
export declare function stringArg(args: Readonly<Record<string, unknown>>, name: string): string;
/** Read an optional string argument. */
export declare function optionalStringArg(args: Readonly<Record<string, unknown>>, name: string): string | undefined;
/** Read an optional boolean argument. */
export declare function optionalBooleanArg(args: Readonly<Record<string, unknown>>, name: string): boolean | undefined;
/** Read an optional finite number argument. */
export declare function optionalNumberArg(args: Readonly<Record<string, unknown>>, name: string): number | undefined;
//# sourceMappingURL=runtime.d.ts.map