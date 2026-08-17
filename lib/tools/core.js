/** Claude-compatible filesystem, shell, web, skill, and workflow tool bodies. */
import { extname } from 'node:path';
import { BlockAssembler, createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm';
import { dispatchNative, dispatchNativeResult, optionalBooleanArg, optionalNumberArg, optionalStringArg, resultText, stringArg, } from "./runtime.js";
import { resolveClaudeWorkflow } from "./workflow.js";
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const CYBER_RISK_REMINDER = '\n\n<system-reminder>\nWhenever you read a file, you should consider whether it would be considered malware. You CAN and SHOULD provide analysis of malware, what it is doing. But you MUST refuse to improve or augment the code. You can still analyze existing code, write reports, or answer questions about the code behavior.\n</system-reminder>\n';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function contentValue(content) {
    return { content: structuredClone(content) };
}
function contentText(content) {
    if (!Array.isArray(content))
        return '';
    return content
        .filter((block) => isRecord(block))
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => String(block.text))
        .join('\n');
}
function nestedError(result) {
    throw new HarnessError(result.error.message, result.error.info?.code ?? 'NESTED_TOOL_FAILED');
}
function shellQuote(value) {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}
function formatReadValue(value, offset) {
    if (!isRecord(value) || !Array.isArray(value.lines))
        return resultText(value);
    const totalLines = typeof value.totalLines === 'number' ? value.totalLines : 0;
    const lines = value.lines.filter((line) => isRecord(line));
    if (lines.length === 0) {
        return totalLines === 0
            ? '<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>'
            : `<system-reminder>Warning: the file exists but is shorter than the provided offset (${offset}). The file has ${totalLines} lines.</system-reminder>`;
    }
    const text = lines.map(line => `${String(line.number)}\t${String(line.text ?? '')}`).join('\n');
    return text + CYBER_RISK_REMINDER;
}
async function readPdf(ctx, filePath, pages, exec) {
    const range = pages === undefined ? undefined : /^(\d+)(?:-(\d+))?$/u.exec(pages);
    if (pages !== undefined && range === null)
        throw new Error(`Invalid pages parameter: "${pages}". Use formats like "1-5", "3", or "10-20". Pages are 1-indexed.`);
    const first = range?.[1];
    const last = range?.[2] ?? first;
    const command = [
        'pdftotext',
        first === undefined ? '' : `-f ${first}`,
        last === undefined ? '' : `-l ${last}`,
        shellQuote(filePath),
        '-',
    ].filter(Boolean).join(' ');
    const value = await dispatchNative(ctx, 'bash', {
        command,
        description: `Read PDF ${filePath}`,
    }, exec, 'pdf');
    if (!isRecord(value) || value.kind !== 'foreground' || !isRecord(value.stdout))
        return resultText(value);
    return String(value.stdout.text ?? '');
}
async function answerWebFetch(ctx, url, prompt, options, exec) {
    const fetched = await dispatchNativeResult(ctx, 'web_fetch', { url }, exec, 'web-fetch');
    if (fetched.isError)
        nestedError(fetched);
    const page = contentText(fetched.content);
    const assembler = new BlockAssembler();
    const message = createUserMessage({
        source: { kind: 'plugin', plugin: 'dsh-claude-code/web-fetch' },
        content: [{
                type: 'text',
                text: `Answer the request using only the fetched page below. If the page does not contain the answer, say so.\n\nURL: ${url}\n\n<page>\n${page}\n</page>\n\nRequest: ${prompt}`,
            }],
    });
    for await (const chunk of ctx.llm.stream({
        provider: options.provider,
        model: options.model,
        messages: [message],
        maxTokens: options.webFetchMaxTokens,
        purpose: 'compaction',
        signal: exec.signal,
    }))
        assembler.push(chunk);
    if (assembler.finish.kind === 'error' || assembler.finish.kind === 'aborted') {
        throw new HarnessError(assembler.finish.failure.message, assembler.finish.failure.code);
    }
    return assembler.blocks()
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');
}
/** Create core tool implementations backed by the shipped DSH tools. */
export function coreToolBodies(ctx, options) {
    return {
        Read: async (args, exec) => {
            const requestedPath = stringArg(args, 'file_path');
            const filePath = options.workspace.path(exec, requestedPath);
            const extension = extname(requestedPath).toLowerCase();
            if (IMAGE_EXTENSIONS.has(extension)) {
                const result = await dispatchNativeResult(ctx, 'read_image', { file_path: filePath }, exec, 'image');
                if (result.isError)
                    nestedError(result);
                return contentValue(result.content);
            }
            if (extension === '.pdf')
                return readPdf(ctx, filePath, optionalStringArg(args, 'pages'), exec);
            const offset = optionalNumberArg(args, 'offset') ?? 1;
            const value = await dispatchNative(ctx, 'read', {
                file_path: filePath,
                offset,
                ...(optionalNumberArg(args, 'limit') === undefined ? {} : { limit: optionalNumberArg(args, 'limit') }),
            }, exec);
            return formatReadValue(value, offset);
        },
        Write: async (args, exec) => {
            const requestedPath = stringArg(args, 'file_path');
            const filePath = options.workspace.path(exec, requestedPath);
            const value = await dispatchNative(ctx, 'write', {
                file_path: filePath,
                content: stringArg(args, 'content'),
            }, exec);
            const operation = isRecord(value) ? value.operation : undefined;
            return operation === 'create'
                ? `File created successfully at: ${requestedPath}`
                : `The file ${requestedPath} has been updated successfully.`;
        },
        Edit: async (args, exec) => {
            const requestedPath = stringArg(args, 'file_path');
            const filePath = options.workspace.path(exec, requestedPath);
            const replaceAll = optionalBooleanArg(args, 'replace_all') ?? false;
            await dispatchNative(ctx, 'edit', {
                file_path: filePath,
                old_string: stringArg(args, 'old_string'),
                new_string: stringArg(args, 'new_string'),
                replace_all: replaceAll,
            }, exec);
            return replaceAll
                ? `The file ${requestedPath} has been updated. All occurrences were successfully replaced.`
                : `The file ${requestedPath} has been updated successfully.`;
        },
        Bash: async (args, exec) => {
            const command = stringArg(args, 'command');
            const value = await dispatchNative(ctx, 'bash', {
                command,
                description: optionalStringArg(args, 'description') ?? command.slice(0, 120),
                workdir: options.workspace.cwd(exec),
                ...(optionalNumberArg(args, 'timeout') === undefined ? {} : { timeoutMs: optionalNumberArg(args, 'timeout') }),
                ...(optionalBooleanArg(args, 'run_in_background') === undefined
                    ? {}
                    : { run_in_background: optionalBooleanArg(args, 'run_in_background') }),
            }, exec);
            if (!isRecord(value))
                return resultText(value);
            if (value.kind === 'background') {
                return `Command running in background with ID: ${String(value.jobId)}`;
            }
            const stdout = isRecord(value.stdout) ? String(value.stdout.text ?? '').replace(/^(\s*\n)+/u, '').trimEnd() : '';
            const stderr = isRecord(value.stderr) ? String(value.stderr.text ?? '').trim() : '';
            const exitCode = typeof value.exitCode === 'number' ? value.exitCode : 0;
            const parts = [stdout, stderr];
            if (value.aborted === true)
                parts.push('<error>Command was aborted before completion</error>');
            if (exitCode !== 0)
                parts.push(`Exit code ${exitCode}`);
            return parts.filter(Boolean).join('\n');
        },
        WebSearch: async (args, exec) => {
            const result = await dispatchNativeResult(ctx, 'web_search', {
                query: stringArg(args, 'query'),
                ...(Array.isArray(args.allowed_domains) ? { allowed_domains: args.allowed_domains } : {}),
                ...(Array.isArray(args.blocked_domains) ? { blocked_domains: args.blocked_domains } : {}),
            }, exec);
            if (result.isError)
                nestedError(result);
            return contentValue(result.content);
        },
        WebFetch: async (args, exec) => answerWebFetch(ctx, stringArg(args, 'url'), stringArg(args, 'prompt'), options, exec),
        Skill: async (args, exec) => {
            const result = await dispatchNativeResult(ctx, 'skill', {
                name: stringArg(args, 'skill'),
                ...(optionalStringArg(args, 'args') === undefined ? {} : { arguments: optionalStringArg(args, 'args') }),
            }, exec);
            if (result.isError)
                nestedError(result);
            return contentValue(result.content);
        },
        Workflow: async (args, exec) => {
            if (optionalStringArg(args, 'resumeFromRunId') !== undefined) {
                throw new Error('Workflow resumeFromRunId is not supported by the current DSH workflow engine');
            }
            const cwd = options.workspace.cwd(exec);
            const workflow = await resolveClaudeWorkflow(args, cwd);
            const result = await dispatchNativeResult(ctx, 'workflow', {
                script: workflow.script,
                meta: workflow.meta,
                ...(args.args === undefined ? {} : { args: args.args }),
            }, exec, 'workflow');
            if (result.isError)
                nestedError(result);
            return contentValue(result.content);
        },
    };
}
//# sourceMappingURL=core.js.map