/** Session-local Claude task list plus adapters for DSH background jobs. */
import { dispatchNativeResult, optionalBooleanArg, optionalNumberArg, optionalStringArg, stringArg, } from "./runtime.js";
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function stringArray(value) {
    return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
}
function sessionKey(exec) {
    return exec.agent === undefined ? '<unscoped>' : String(exec.agent.session.id);
}
function taskType(kind) {
    if (kind === 'bash')
        return 'local_bash';
    if (kind === 'subagent')
        return 'local_agent';
    return kind;
}
function formatTaskOutput(task) {
    const parts = [
        `<retrieval_status>${task.retrievalStatus}</retrieval_status>`,
        `<task_id>${task.id}</task_id>`,
        `<task_type>${task.type}</task_type>`,
        `<status>${task.status}</status>`,
    ];
    if (task.exitCode !== undefined)
        parts.push(`<exit_code>${task.exitCode}</exit_code>`);
    if (task.output.trim().length > 0)
        parts.push(`<output>\n${task.output.trimEnd()}\n</output>`);
    if (task.error !== undefined)
        parts.push(`<error>${task.error}</error>`);
    return parts.join('\n\n');
}
function nativeJob(value) {
    if (!isRecord(value) || !isRecord(value.job))
        return undefined;
    const job = value.job;
    if (typeof job.id !== 'string'
        || typeof job.kind !== 'string'
        || typeof job.label !== 'string'
        || typeof job.status !== 'string')
        return undefined;
    return {
        id: job.id,
        kind: job.kind,
        label: job.label,
        status: job.status,
        ...(typeof job.detail === 'string' ? { detail: job.detail } : {}),
    };
}
function nativeJobOutput(value) {
    return isRecord(value) && typeof value.text === 'string' ? value.text : '';
}
function exitCode(detail) {
    if (detail === undefined)
        return undefined;
    const match = /^exit code: (-?\d+)$/u.exec(detail);
    if (match === null)
        return undefined;
    const code = Number(match[1]);
    return Number.isSafeInteger(code) ? code : undefined;
}
function backgroundProjection(task, retrievalStatus) {
    return {
        retrievalStatus,
        id: task.id,
        type: 'local_agent',
        status: task.status,
        output: task.output,
        ...(task.error === undefined ? {} : { error: task.error }),
    };
}
/** Mutable task state intentionally scoped to this plugin lifetime and DSH session id. */
export class ClaudeTaskStore {
    background;
    lists = new Map();
    /** Share background-agent lifecycle state with Agent and SendMessage. */
    constructor(background) {
        this.background = background;
    }
    list(exec) {
        const key = sessionKey(exec);
        let state = this.lists.get(key);
        if (state === undefined) {
            state = { nextId: 1, tasks: new Map() };
            this.lists.set(key, state);
        }
        return state;
    }
    /** Build the task and job tool bodies sharing this store. */
    bodies(ctx) {
        return {
            TaskCreate: async (args, exec) => {
                const list = this.list(exec);
                const id = String(list.nextId);
                list.nextId += 1;
                const activeForm = optionalStringArg(args, 'activeForm');
                const task = {
                    id,
                    subject: stringArg(args, 'subject'),
                    description: stringArg(args, 'description'),
                    ...(activeForm === undefined ? {} : { activeForm }),
                    status: 'pending',
                    blocks: new Set(),
                    blockedBy: new Set(),
                    ...(isRecord(args.metadata) ? { metadata: structuredClone(args.metadata) } : {}),
                };
                list.tasks.set(id, task);
                return `Task #${id} created successfully: ${task.subject}`;
            },
            TaskGet: async (args, exec) => {
                const id = stringArg(args, 'taskId');
                const task = this.list(exec).tasks.get(id);
                if (task === undefined)
                    return 'Task not found';
                const lines = [
                    `Task #${task.id}: ${task.subject}`,
                    `Status: ${task.status}`,
                    `Description: ${task.description}`,
                ];
                if (task.blockedBy.size > 0)
                    lines.push(`Blocked by: ${[...task.blockedBy].map(value => `#${value}`).join(', ')}`);
                if (task.blocks.size > 0)
                    lines.push(`Blocks: ${[...task.blocks].map(value => `#${value}`).join(', ')}`);
                return lines.join('\n');
            },
            TaskList: async (_args, exec) => {
                const tasks = [...this.list(exec).tasks.values()];
                if (tasks.length === 0)
                    return 'No tasks found';
                const completed = new Set(tasks.filter(task => task.status === 'completed').map(task => task.id));
                return tasks.map(task => {
                    const owner = task.owner === undefined ? '' : ` (${task.owner})`;
                    const unresolved = [...task.blockedBy].filter(id => !completed.has(id));
                    const blocked = unresolved.length === 0 ? '' : ` [blocked by ${unresolved.map(id => `#${id}`).join(', ')}]`;
                    return `#${task.id} [${task.status}] ${task.subject}${owner}${blocked}`;
                }).join('\n');
            },
            TaskUpdate: async (args, exec) => {
                const id = stringArg(args, 'taskId');
                const list = this.list(exec);
                const task = list.tasks.get(id);
                if (task === undefined)
                    return 'Task not found';
                const updated = [];
                for (const field of ['subject', 'description', 'activeForm', 'owner']) {
                    const value = optionalStringArg(args, field);
                    if (value !== undefined && task[field] !== value) {
                        task[field] = value;
                        updated.push(field);
                    }
                }
                const status = optionalStringArg(args, 'status');
                if (status === 'deleted') {
                    list.tasks.delete(id);
                    return `Updated task #${id} deleted`;
                }
                if ((status === 'pending' || status === 'in_progress' || status === 'completed') && status !== task.status) {
                    task.status = status;
                    updated.push('status');
                }
                for (const blocked of stringArray(args.addBlocks))
                    task.blocks.add(blocked);
                if (stringArray(args.addBlocks).length > 0)
                    updated.push('blocks');
                for (const blocker of stringArray(args.addBlockedBy))
                    task.blockedBy.add(blocker);
                if (stringArray(args.addBlockedBy).length > 0)
                    updated.push('blockedBy');
                if (isRecord(args.metadata)) {
                    const metadata = { ...task.metadata };
                    for (const [key, value] of Object.entries(args.metadata)) {
                        if (value === null)
                            delete metadata[key];
                        else
                            metadata[key] = structuredClone(value);
                    }
                    task.metadata = metadata;
                    updated.push('metadata');
                }
                return `Updated task #${id} ${updated.join(', ')}`;
            },
            TaskOutput: async (args, exec) => {
                const id = stringArg(args, 'task_id');
                const block = optionalBooleanArg(args, 'block') ?? true;
                const timeout = optionalNumberArg(args, 'timeout') ?? 30_000;
                const background = this.background.get(id);
                if (background !== undefined) {
                    const active = background.status === 'pending' || background.status === 'running';
                    if (!active)
                        return formatTaskOutput(backgroundProjection(background, 'success'));
                    if (!block)
                        return formatTaskOutput(backgroundProjection(background, 'not_ready'));
                    const settled = await this.background.wait(id, timeout, exec.signal);
                    const current = this.background.get(id);
                    if (current === undefined)
                        throw new Error(`No task found with ID: ${id}`);
                    return formatTaskOutput(backgroundProjection(current, settled ? 'success' : 'timeout'));
                }
                const result = await dispatchNativeResult(ctx, 'job_output', {
                    job_id: id,
                    wait: block,
                    timeout_ms: timeout,
                }, exec, 'job-output');
                if (result.isError)
                    throw new Error(result.error.message);
                const job = nativeJob(result.value);
                if (job === undefined)
                    throw new Error('job_output returned an invalid task record');
                const active = job.status === 'running' || job.status === 'stopping';
                const retrievalStatus = active ? (block ? 'timeout' : 'not_ready') : 'success';
                const code = exitCode(job.detail);
                return formatTaskOutput({
                    retrievalStatus,
                    id: job.id,
                    type: taskType(job.kind),
                    status: job.status === 'stopping' ? 'running' : job.status,
                    output: nativeJobOutput(result.value),
                    ...(code === undefined ? {} : { exitCode: code }),
                    ...(job.status === 'failed' && job.detail !== undefined ? { error: job.detail } : {}),
                });
            },
            TaskStop: async (args, exec) => {
                const id = optionalStringArg(args, 'task_id') ?? optionalStringArg(args, 'shell_id');
                if (id === undefined)
                    throw new Error('Either task_id or shell_id must be provided');
                const background = this.background.get(id);
                if (background !== undefined) {
                    if (background.status !== 'pending' && background.status !== 'running') {
                        throw new Error(`Task ${id} is not running (status: ${background.status})`);
                    }
                    const result = await dispatchNativeResult(ctx, 'interrupt_agent', { agent_id: id }, exec, 'interrupt-agent');
                    if (result.isError)
                        throw new Error(result.error.message);
                    this.background.markKilled(id);
                    return JSON.stringify({
                        message: `Successfully stopped task: ${id} (${background.description})`,
                        task_id: id,
                        task_type: 'local_agent',
                        command: background.description,
                    });
                }
                const result = await dispatchNativeResult(ctx, 'job_kill', { job_id: id }, exec, 'job-kill');
                if (result.isError)
                    throw new Error(result.error.message);
                const job = nativeJob(result.value);
                if (job === undefined)
                    throw new Error('job_kill returned an invalid task record');
                if (isRecord(result.value) && result.value.outcome === 'already-finished') {
                    throw new Error(`Task ${id} is not running (status: ${job.status})`);
                }
                return JSON.stringify({
                    message: `Successfully stopped task: ${job.id} (${job.label})`,
                    task_id: job.id,
                    task_type: taskType(job.kind),
                    command: job.label,
                });
            },
        };
    }
}
//# sourceMappingURL=tasks.js.map