/** Shared registration, validation, and nested-dispatch helpers for Claude-facing tools. */
import { Ajv2020 } from 'ajv/dist/2020.js';
import { CallId, HarnessError } from '@deepseek-ai/dsh-llm';
import { CLAUDE_CODE_BASELINE } from "../generated/claude-code-baseline.js";
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
class ClaudeInputValidationError extends HarnessError {
    constructor(message) {
        super(`InputValidationError: ${message}`, 'INVALID_ARGS');
        this.name = 'ClaudeInputValidationError';
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validationMessage(errors) {
    if (errors === null || errors === undefined || errors.length === 0)
        return 'invalid input';
    return errors.map(error => {
        const location = error.instancePath.length === 0 ? 'input' : `input${error.instancePath}`;
        return `${location} ${error.message ?? 'is invalid'}`;
    }).join('; ');
}
const validators = new Map();
function validate(tool, args) {
    let validator = validators.get(tool.name);
    if (validator === undefined) {
        validator = ajv.compile(tool.input_schema);
        validators.set(tool.name, validator);
    }
    const compiled = validator;
    if (!compiled(args))
        throw new ClaudeInputValidationError(validationMessage(compiled.errors));
    if (!isRecord(args))
        throw new ClaudeInputValidationError('input must be an object');
}
const SUPPORTED_KEYS = new Set([
    'type',
    'oneOf',
    'properties',
    'required',
    'additionalProperties',
    'items',
    'enum',
    'const',
    'title',
    'description',
    'default',
    'deprecated',
    'readOnly',
    'writeOnly',
    'examples',
]);
/** Reduce a full draft-2020 schema to DSH's execution-registry subset. */
export function registrySchema(value) {
    if (!isRecord(value))
        return {};
    const result = {};
    for (const [key, child] of Object.entries(value)) {
        const normalizedKey = key === 'anyOf' ? 'oneOf' : key;
        if (!SUPPORTED_KEYS.has(normalizedKey))
            continue;
        switch (normalizedKey) {
            case 'properties':
                result.properties = isRecord(child)
                    ? Object.fromEntries(Object.entries(child).map(([name, schema]) => [name, registrySchema(schema)]))
                    : {};
                break;
            case 'items':
                result.items = registrySchema(child);
                break;
            case 'oneOf':
                result.oneOf = Array.isArray(child) ? child.map(registrySchema) : [];
                break;
            case 'additionalProperties':
                result.additionalProperties = typeof child === 'boolean' ? child : true;
                break;
            default:
                result[normalizedKey] = structuredClone(child);
        }
    }
    return result;
}
function renderValue(value) {
    if (typeof value === 'string')
        return [{ type: 'text', text: value }];
    if (isRecord(value) && Array.isArray(value.content)) {
        return structuredClone(value.content);
    }
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}
function finalizeError(result) {
    if (!result.isError)
        return undefined;
    return [{ type: 'text', text: `<tool_use_error>${result.error.message}</tool_use_error>` }];
}
/** Construct one executable DSH definition while the prompt listener owns its exact wire schema. */
export function capturedToolDefinition(tool, body) {
    return {
        name: tool.name,
        description: tool.description,
        parameters: registrySchema(tool.input_schema),
        output: {
            schema: {},
            render: (_args, value) => renderValue(value),
        },
        async execute(args, exec) {
            validate(tool, args);
            return body(args, exec);
        },
        finalizeContent: (_exec, result) => finalizeError(result),
        isConcurrencySafe: () => ['Read', 'RemoteTrigger', 'ListAgents', 'CronList'].includes(tool.name),
        presentCall: args => ({ card: 'generic', title: tool.name, rawInput: JSON.stringify(args) }),
    };
}
/** Look up one captured tool by its stable name. */
export function capturedTool(name) {
    const tool = CLAUDE_CODE_BASELINE.tools.find(candidate => candidate.name === name);
    if (tool === undefined)
        throw new Error(`captured Claude Code tool ${name} is missing`);
    return tool;
}
function nestedFailure(result) {
    throw new HarnessError(result.error.message, result.error.info?.code ?? 'NESTED_TOOL_FAILED');
}
/** Dispatch one existing DSH tool through its complete policy and result pipeline. */
export async function dispatchNative(ctx, name, args, exec, suffix = 'native') {
    const result = await dispatchNativeResult(ctx, name, args, exec, suffix);
    if (result.isError)
        nestedFailure(result);
    return result.value;
}
/** Dispatch an existing DSH tool and retain both its canonical value and rendered content. */
export async function dispatchNativeResult(ctx, name, args, exec, suffix = 'native') {
    const result = await ctx.tools.execute({
        callId: CallId(`${String(exec.callId)}:${suffix}`),
        rootCallId: exec.rootCallId,
        name,
        arguments: args,
        ...(exec.agent === undefined ? {} : { agent: exec.agent }),
        parent: exec.token,
        signal: exec.signal,
    });
    for (const context of result.additionalContexts ?? [])
        exec.deferContext(context);
    if (result.concludesTurn === true)
        exec.concludeTurn();
    return result;
}
/** Extract text from a nested Native result when no richer projection is needed. */
export function resultText(result) {
    if (typeof result === 'string')
        return result;
    if (isRecord(result)) {
        if (typeof result.text === 'string')
            return result.text;
        if (Array.isArray(result.content)) {
            return result.content
                .filter((block) => isRecord(block))
                .filter(block => block.type === 'text' && typeof block.text === 'string')
                .map(block => String(block.text))
                .join('\n');
        }
    }
    return JSON.stringify(result, null, 2);
}
/** Require a string argument after the captured JSON Schema has run. */
export function stringArg(args, name) {
    const value = args[name];
    if (typeof value !== 'string')
        throw new ClaudeInputValidationError(`input/${name} must be string`);
    return value;
}
/** Read an optional string argument. */
export function optionalStringArg(args, name) {
    const value = args[name];
    return typeof value === 'string' ? value : undefined;
}
/** Read an optional boolean argument. */
export function optionalBooleanArg(args, name) {
    const value = args[name];
    return typeof value === 'boolean' ? value : undefined;
}
/** Read an optional finite number argument. */
export function optionalNumberArg(args, name) {
    const value = args[name];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
//# sourceMappingURL=runtime.js.map