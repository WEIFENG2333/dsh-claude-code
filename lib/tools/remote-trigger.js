/** Claude.ai remote-trigger access without exposing the OAuth token to the model or shell. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { optionalStringArg, stringArg } from "./runtime.js";
const API_ORIGIN = 'https://api.anthropic.com';
const TRIGGERS_BETA = 'ccr-triggers-2026-01-30';
const MAX_RESPONSE_CHARS = 100_000;
function objectArg(args, name) {
    const value = args[name];
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
function requireId(args, name, action) {
    const value = optionalStringArg(args, name);
    if (value === undefined)
        throw new Error(`${action} requires ${name}`);
    return value;
}
function requireBody(args, action) {
    const body = objectArg(args, 'body');
    if (body === undefined)
        throw new Error(`${action} requires body`);
    return body;
}
function appendCursor(url, args) {
    const cursor = optionalStringArg(args, 'cursor');
    if (cursor !== undefined)
        url.searchParams.set('cursor', cursor);
}
function target(args) {
    const action = stringArg(args, 'action');
    const triggers = new URL('/v1/code/triggers', API_ORIGIN);
    switch (action) {
        case 'list':
            return { method: 'GET', url: triggers };
        case 'get':
            return { method: 'GET', url: new URL(`${triggers.pathname}/${requireId(args, 'trigger_id', action)}`, API_ORIGIN) };
        case 'create':
            return { method: 'POST', url: triggers, body: requireBody(args, action) };
        case 'update':
            return {
                method: 'POST',
                url: new URL(`${triggers.pathname}/${requireId(args, 'trigger_id', action)}`, API_ORIGIN),
                body: requireBody(args, action),
            };
        case 'run':
            return {
                method: 'POST',
                url: new URL(`${triggers.pathname}/${requireId(args, 'trigger_id', action)}/run`, API_ORIGIN),
                body: objectArg(args, 'body') ?? {},
            };
        case 'create_webhook_trigger':
            return {
                method: 'POST',
                url: new URL('/v1/code/webhook-triggers', API_ORIGIN),
                body: requireBody(args, action),
            };
        case 'list_runs': {
            const url = new URL('/v1/code/sessions', API_ORIGIN);
            url.searchParams.set('trigger_id', requireId(args, 'trigger_id', action));
            appendCursor(url, args);
            return { method: 'GET', url };
        }
        case 'get_run_log': {
            const session = requireId(args, 'session_id', action);
            const url = new URL(`/v1/code/sessions/${session}/events`, API_ORIGIN);
            appendCursor(url, args);
            return { method: 'GET', url };
        }
        default:
            throw new Error(`Unsupported RemoteTrigger action: ${action}`);
    }
}
async function credentials(configDir) {
    let parsed;
    try {
        parsed = JSON.parse(await readFile(join(configDir, '.credentials.json'), 'utf8'));
    }
    catch (error) {
        throw new Error('RemoteTrigger requires a claude.ai login in the configured Claude directory', { cause: error });
    }
    const accessToken = parsed.claudeAiOauth?.accessToken;
    const organizationUuid = parsed.organizationUuid;
    if (typeof accessToken !== 'string' || accessToken.length === 0 || typeof organizationUuid !== 'string' || organizationUuid.length === 0) {
        throw new Error('RemoteTrigger could not read the claude.ai OAuth token and organization ID; run claude /login');
    }
    const expiresAt = parsed.claudeAiOauth?.expiresAt;
    if (typeof expiresAt === 'number' && expiresAt <= Date.now()) {
        throw new Error('RemoteTrigger found an expired claude.ai OAuth token; run claude /login to refresh it');
    }
    return { accessToken, organizationUuid };
}
/** Build the account-scoped RemoteTrigger tool over Claude Code's local OAuth file. */
export function remoteTriggerBody(configDir) {
    return async (args, exec) => {
        const auth = await credentials(configDir);
        const request = target(args);
        const response = await fetch(request.url, {
            method: request.method,
            headers: {
                authorization: `Bearer ${auth.accessToken}`,
                'content-type': 'application/json',
                'anthropic-version': '2023-06-01',
                'anthropic-beta': TRIGGERS_BETA,
                'x-organization-uuid': auth.organizationUuid,
            },
            ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
            signal: exec.signal,
        });
        const raw = await response.text();
        const text = raw.length <= MAX_RESPONSE_CHARS
            ? raw
            : `${raw.slice(0, MAX_RESPONSE_CHARS)}\n... (response truncated at ${MAX_RESPONSE_CHARS} characters)`;
        return `HTTP ${response.status}${text.length === 0 ? '' : `\n${text}`}`;
    };
}
//# sourceMappingURL=remote-trigger.js.map