/** Claude-compatible subagent, scheduling, monitoring, and notification tools. */
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { humanCron, nextCronRun, parseCron } from "./cron.js";
import { dispatchNative, dispatchNativeResult, optionalBooleanArg, optionalNumberArg, optionalStringArg, stringArg, } from "./runtime.js";
const MAX_CRON_JOBS = 50;
const RECURRING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function sessionKey(exec) {
    return exec.agent === undefined ? '<unscoped>' : String(exec.agent.session.id);
}
function shellQuote(value) {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}
/** Stateful coordination bodies, isolated by DSH session id. */
export class CoordinationTools {
    background;
    workspace;
    onboarding;
    crons = new Map();
    wakeups = new Map();
    context;
    /** Build coordination tools over one shared Claude task projection. */
    constructor(background, workspace, onboarding) {
        this.background = background;
        this.workspace = workspace;
        this.onboarding = onboarding;
    }
    cronList(exec) {
        const key = sessionKey(exec);
        let records = this.crons.get(key);
        if (records === undefined) {
            records = new Map();
            this.crons.set(key, records);
        }
        return records;
    }
    deleteCron(record) {
        if (record.timer !== undefined)
            clearTimeout(record.timer);
        this.crons.get(record.session)?.delete(record.id);
    }
    fireCron(record) {
        try {
            record.agent.followup(createUserMessage({
                source: { kind: 'user' },
                content: [{ type: 'text', text: record.prompt }],
            }));
        }
        catch (error) {
            this.context?.logger.warn(error instanceof Error ? error : new Error(String(error)));
            this.deleteCron(record);
            return;
        }
        if (!record.recurring || Date.now() - record.createdAt >= RECURRING_MAX_AGE_MS) {
            this.deleteCron(record);
            return;
        }
        this.scheduleCron(record);
    }
    armCron(record) {
        const remaining = Math.max(0, record.nextAt - Date.now());
        const delay = Math.min(remaining, MAX_TIMER_DELAY_MS);
        record.timer = setTimeout(() => {
            if (Date.now() < record.nextAt)
                this.armCron(record);
            else
                this.fireCron(record);
        }, delay);
    }
    scheduleCron(record) {
        const next = nextCronRun(record.cron, new Date());
        if (next === undefined) {
            this.deleteCron(record);
            return;
        }
        record.nextAt = next.getTime();
        this.armCron(record);
    }
    disposeSchedules() {
        for (const records of this.crons.values()) {
            for (const record of records.values())
                if (record.timer !== undefined)
                    clearTimeout(record.timer);
        }
        for (const record of this.wakeups.values())
            clearTimeout(record.timer);
        this.crons.clear();
        this.wakeups.clear();
    }
    /** Create tool bodies over the DSH subagent, job, and schedule capabilities. */
    bodies(ctx) {
        this.context = ctx;
        ctx.effect(() => () => this.disposeSchedules(), 'dsh-claude-code: schedule teardown');
        return {
            Agent: async (args, exec) => {
                const description = stringArg(args, 'description');
                const prompt = stringArg(args, 'prompt');
                const result = await dispatchNativeResult(ctx, 'subagent', {
                    description,
                    prompt,
                    ...(optionalBooleanArg(args, 'run_in_background') === undefined
                        ? {}
                        : { run_in_background: optionalBooleanArg(args, 'run_in_background') }),
                }, exec, 'agent');
                if (result.isError)
                    throw new Error(result.error.message);
                if (isRecord(result.value) && result.value.kind === 'continuable' && typeof result.value.subagentId === 'string') {
                    const id = result.value.subagentId;
                    this.background.register(id, description, prompt);
                    return `Async agent launched successfully.\nagentId: ${id} (internal ID - do not mention to user. Use SendMessage with to: '${id}' to continue this agent.)\nThe agent is working in the background. You will be notified automatically when it completes.\nBriefly tell the user what you launched and end your response. Do not generate any other text — agent results will arrive in a subsequent message.`;
                }
                return { content: result.content };
            },
            ListAgents: async (_args, exec) => {
                const result = await dispatchNativeResult(ctx, 'list_agents', {}, exec, 'list-agents');
                if (result.isError)
                    throw new Error(result.error.message);
                return { content: result.content };
            },
            SendMessage: async (args, exec) => {
                const to = stringArg(args, 'to').replace(/^agent:/u, '');
                const prepared = this.background.prepareTurn(to);
                const result = await dispatchNativeResult(ctx, 'send_message', {
                    subagent_id: to,
                    message: stringArg(args, 'message'),
                }, exec, 'send-message');
                if (result.isError) {
                    prepared?.rollback();
                    throw new Error(result.error.message);
                }
                if (prepared === undefined || prepared.previousStatus === 'pending' || prepared.previousStatus === 'running') {
                    return `Message queued for delivery to ${to} at its next tool round.`;
                }
                return `Agent "${to}" was stopped (${prepared.previousStatus}); resumed it in the background with your message. You'll be notified when it finishes.`;
            },
            CronCreate: async (args, exec) => {
                const cron = stringArg(args, 'cron');
                if (parseCron(cron) === undefined)
                    throw new Error(`Invalid cron expression '${cron}'. Expected 5 fields: M H DoM Mon DoW.`);
                const firstRun = nextCronRun(cron, new Date());
                if (firstRun === undefined)
                    throw new Error(`Cron expression '${cron}' does not match any calendar date in the next year.`);
                const agent = exec.agent;
                if (agent === undefined)
                    throw new Error('CronCreate requires a calling agent');
                const records = this.cronList(exec);
                if (records.size >= MAX_CRON_JOBS)
                    throw new Error(`Too many scheduled jobs (max ${MAX_CRON_JOBS}). Cancel one first.`);
                const recurring = optionalBooleanArg(args, 'recurring') ?? true;
                let id;
                do
                    id = randomBytes(4).toString('hex');
                while (records.has(id));
                const record = {
                    id,
                    session: sessionKey(exec),
                    cron,
                    prompt: stringArg(args, 'prompt'),
                    recurring,
                    humanSchedule: humanCron(cron),
                    createdAt: Date.now(),
                    agent,
                    nextAt: firstRun.getTime(),
                };
                records.set(id, record);
                this.armCron(record);
                const where = 'Session-only (not written to disk, dies when Claude exits)';
                return recurring
                    ? `Scheduled recurring job ${id} (${record.humanSchedule}). ${where}. Auto-expires after 7 days. Use CronDelete to cancel sooner.`
                    : `Scheduled one-shot task ${id} (${record.humanSchedule}). ${where}. It will fire once then auto-delete.`;
            },
            CronList: async (_args, exec) => {
                const records = [...this.cronList(exec).values()];
                return records.length === 0
                    ? 'No scheduled jobs.'
                    : records.map(record => `${record.id} — ${record.humanSchedule}${record.recurring ? ' (recurring)' : ' (one-shot)'} [session-only]: ${record.prompt.slice(0, 80)}`).join('\n');
            },
            CronDelete: async (args, exec) => {
                const id = stringArg(args, 'id');
                const record = this.cronList(exec).get(id);
                if (record === undefined)
                    throw new Error(`No scheduled job with id '${id}'`);
                this.deleteCron(record);
                return `Cancelled job ${id}.`;
            },
            ScheduleWakeup: async (args, exec) => {
                const key = sessionKey(exec);
                const existing = this.wakeups.get(key);
                if (optionalBooleanArg(args, 'stop') === true) {
                    if (existing !== undefined)
                        clearTimeout(existing.timer);
                    this.wakeups.delete(key);
                    return 'Dynamic loop stopped. No further wakeups will fire.';
                }
                const agent = exec.agent;
                if (agent === undefined)
                    throw new Error('ScheduleWakeup requires a calling agent');
                const requestedDelay = optionalNumberArg(args, 'delaySeconds');
                const reason = optionalStringArg(args, 'reason');
                const prompt = optionalStringArg(args, 'prompt');
                const noop = optionalBooleanArg(args, 'noop');
                if (requestedDelay === undefined || reason === undefined || prompt === undefined || noop === undefined) {
                    throw new Error('ScheduleWakeup requires delaySeconds, reason, prompt, and noop unless stop is true');
                }
                const delaySeconds = Math.min(3_600, Math.max(60, Math.trunc(requestedDelay)));
                if (existing !== undefined)
                    clearTimeout(existing.timer);
                const timer = setTimeout(() => {
                    this.wakeups.delete(key);
                    try {
                        agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] }));
                    }
                    catch (error) {
                        this.context?.logger.warn(error instanceof Error ? error : new Error(String(error)));
                    }
                }, delaySeconds * 1_000);
                this.wakeups.set(key, { session: key, agent, prompt, reason, delaySeconds, noop, timer });
                return `Wakeup scheduled in ${delaySeconds} seconds: ${reason}`;
            },
            Monitor: async (args, exec) => {
                let command = optionalStringArg(args, 'command');
                if (command === undefined && isRecord(args.ws) && typeof args.ws.url === 'string') {
                    const protocols = Array.isArray(args.ws.protocols)
                        ? args.ws.protocols.filter((value) => typeof value === 'string')
                        : [];
                    const script = `const ws=new WebSocket(${JSON.stringify(args.ws.url)},${JSON.stringify(protocols)});ws.onmessage=e=>console.log(typeof e.data==='string'?e.data:'[binary frame]');ws.onclose=e=>{console.error('WebSocket closed '+e.code);process.exit(0)};ws.onerror=()=>process.exit(1)`;
                    command = `node -e ${shellQuote(script)}`;
                }
                if (command === undefined)
                    throw new Error('Monitor requires command or ws');
                const result = await dispatchNativeResult(ctx, 'bash', {
                    command,
                    description: stringArg(args, 'description'),
                    workdir: this.workspace.cwd(exec),
                    run_in_background: true,
                    ...optionalBooleanArg(args, 'persistent') === true
                        ? {}
                        : { timeoutMs: optionalNumberArg(args, 'timeout_ms') ?? 300_000 },
                }, exec, 'monitor');
                if (result.isError)
                    throw new Error(result.error.message);
                return { content: result.content };
            },
            PushNotification: async (args, exec) => {
                const message = stringArg(args, 'message');
                const status = optionalStringArg(args, 'status') ?? 'Claude Code';
                await dispatchNative(ctx, 'bash', {
                    command: `if command -v notify-send >/dev/null 2>&1; then notify-send ${shellQuote(status)} ${shellQuote(message)}; fi`,
                    description: 'Send desktop notification',
                    workdir: this.workspace.cwd(exec),
                }, exec, 'notification');
                return 'Notification sent.';
            },
            ReportFindings: async (args, exec) => {
                const findings = Array.isArray(args.findings) ? args.findings : [];
                const path = this.workspace.path(exec, '.dsh/claude-review-findings.json');
                await mkdir(dirname(path), { recursive: true });
                await writeFile(path, `${JSON.stringify({
                    level: optionalStringArg(args, 'level'),
                    findings,
                    updatedAt: new Date().toISOString(),
                }, null, 2)}\n`, 'utf8');
                return `Reported ${findings.length} finding${findings.length === 1 ? '' : 's'}.`;
            },
            ShareOnboardingGuide: (args, exec) => this.onboarding.run(args, exec),
        };
    }
}
//# sourceMappingURL=coordination.js.map