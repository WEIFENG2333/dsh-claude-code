/** DSH bundle plugin reproducing the captured Claude Code request and tool surface. */
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm';
import { ClaudeCodeAdapter } from "./adapter.js";
import { CLAUDE_CODE_BASELINE } from "./generated/claude-code-baseline.js";
import { captureClaudeInstructions } from "./instructions.js";
import { capturedAgentContext, captureRuntimeEnvironment, currentDateReminder, materializeCapturedSystem, } from "./request.js";
import { ClaudeBackgroundTasks } from "./tools/background.js";
import { CoordinationTools } from "./tools/coordination.js";
import { coreToolBodies } from "./tools/core.js";
import { DesignSyncStore } from "./tools/design-sync.js";
import { notebookToolBodies } from "./tools/notebook.js";
import { LocalOnboardingGuides } from "./tools/onboarding.js";
import { capturedToolDefinition } from "./tools/runtime.js";
import { runtimeServiceBodies } from "./tools/runtime-services.js";
import { ClaudeTaskStore } from "./tools/tasks.js";
import { WorktreeTools } from "./tools/worktree.js";
import { ClaudeWorkspace } from "./tools/workspace.js";
/** Cordis plugin name. */
export const name = 'claude-code-compat';
/** Required DSH capability seams. */
export const inject = ['llm', 'tools', 'systemPrompt', 'credentials'];
const DEFAULT_PROVIDER = 'deepseek-claude-code';
const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic';
const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_MAX_TOKENS = 32_000;
const DEFAULT_CONTEXT_WINDOW = 1_000_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 600_000;
const DEFAULT_WEB_FETCH_MAX_TOKENS = 4_096;
const DEFAULT_DESIGN_ROOT = '.dsh/claude-design-projects';
const DEFAULT_ONBOARDING_ROOT = '.dsh/claude-onboarding-guides';
/** Runtime validation for the plugin configuration. */
export const Config = z.object({
    provider: z.string().default(DEFAULT_PROVIDER),
    baseURL: z.string().default(DEFAULT_BASE_URL),
    apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
    model: z.string().default(DEFAULT_MODEL),
    maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_TOKENS),
    contextWindow: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_CONTEXT_WINDOW),
    effort: z.union(['low', 'medium', 'high', 'xhigh', 'max']).default('max'),
    requestTimeoutMs: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_REQUEST_TIMEOUT_MS),
    webFetchMaxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_WEB_FETCH_MAX_TOKENS),
    timeZone: z.string(),
    claudeConfigPath: z.string(),
    deviceId: z.string(),
    accountUuid: z.string(),
    sessionId: z.string(),
    designRoot: z.string().default(DEFAULT_DESIGN_ROOT),
    onboardingRoot: z.string().default(DEFAULT_ONBOARDING_ROOT),
    loadClaudeInstructions: z.boolean().default(true),
    claudeConfigDir: z.string(),
});
function requiredText(value, fallback, field) {
    const resolved = value ?? fallback;
    if (resolved.trim().length === 0)
        throw new Error(`dsh-claude-code: ${field} must be non-empty`);
    return resolved;
}
function positiveInteger(value, fallback, field) {
    const resolved = value ?? fallback;
    if (!Number.isSafeInteger(resolved) || resolved <= 0) {
        throw new Error(`dsh-claude-code: ${field} must be a positive safe integer`);
    }
    return resolved;
}
/** Materialize every default and reject programmatic configurations that bypass Schemastery. */
export function resolveConfig(config) {
    const baseURL = requiredText(config.baseURL, DEFAULT_BASE_URL, 'baseURL').replace(/\/+$/u, '');
    let endpoint;
    try {
        endpoint = new URL(baseURL);
    }
    catch (error) {
        throw new Error('dsh-claude-code: baseURL must be an absolute HTTP(S) URL', { cause: error });
    }
    if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
        throw new Error('dsh-claude-code: baseURL must use HTTP or HTTPS');
    }
    if (config.timeZone !== undefined) {
        try {
            new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone }).format();
        }
        catch (error) {
            throw new Error(`dsh-claude-code: invalid timeZone ${JSON.stringify(config.timeZone)}`, { cause: error });
        }
    }
    return {
        provider: requiredText(config.provider, DEFAULT_PROVIDER, 'provider'),
        baseURL,
        apiKeyEnv: requiredText(config.apiKeyEnv, DEFAULT_API_KEY_ENV, 'apiKeyEnv'),
        model: requiredText(config.model, DEFAULT_MODEL, 'model'),
        maxTokens: positiveInteger(config.maxTokens, DEFAULT_MAX_TOKENS, 'maxTokens'),
        contextWindow: positiveInteger(config.contextWindow, DEFAULT_CONTEXT_WINDOW, 'contextWindow'),
        effort: config.effort ?? 'max',
        requestTimeoutMs: positiveInteger(config.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs'),
        webFetchMaxTokens: positiveInteger(config.webFetchMaxTokens, DEFAULT_WEB_FETCH_MAX_TOKENS, 'webFetchMaxTokens'),
        designRoot: resolve(config.designRoot ?? DEFAULT_DESIGN_ROOT),
        onboardingRoot: resolve(config.onboardingRoot ?? DEFAULT_ONBOARDING_ROOT),
        loadClaudeInstructions: config.loadClaudeInstructions ?? true,
        claudeConfigDir: resolve(config.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR ?? resolve(homedir(), '.claude')),
        ...(config.timeZone === undefined ? {} : { timeZone: config.timeZone }),
        ...(config.claudeConfigPath === undefined ? {} : { claudeConfigPath: config.claudeConfigPath }),
        ...(config.deviceId === undefined ? {} : { deviceId: config.deviceId }),
        ...(config.accountUuid === undefined ? {} : { accountUuid: config.accountUuid }),
        ...(config.sessionId === undefined ? {} : { sessionId: config.sessionId }),
    };
}
function capturedSchemas() {
    return CLAUDE_CODE_BASELINE.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: structuredClone(tool.input_schema),
    }));
}
function exactToolAssembly(result) {
    return { ...result, tools: capturedSchemas() };
}
function toolBodies(ctx, config) {
    const background = new ClaudeBackgroundTasks(ctx);
    const workspace = new ClaudeWorkspace();
    const onboarding = new LocalOnboardingGuides(config.onboardingRoot, workspace);
    return {
        ...coreToolBodies(ctx, {
            provider: config.provider,
            model: config.model,
            webFetchMaxTokens: config.webFetchMaxTokens,
            workspace,
        }),
        ...new ClaudeTaskStore(background).bodies(ctx),
        ...new CoordinationTools(background, workspace, onboarding).bodies(ctx),
        ...notebookToolBodies(ctx, workspace),
        ...runtimeServiceBodies(ctx, workspace),
        ...new WorktreeTools(workspace).bodies(ctx),
        DesignSync: new DesignSyncStore(config.designRoot, workspace).body(),
    };
}
/** Register the exact prompt/tool surface and Anthropic-compatible adapter. */
export function apply(ctx, rawConfig) {
    const config = resolveConfig(rawConfig);
    const capturedSystem = materializeCapturedSystem(captureRuntimeEnvironment(config.model, process.cwd(), `${resolve(config.claudeConfigDir, 'memory')}/`));
    const claudeInstructions = config.loadClaudeInstructions
        ? captureClaudeInstructions(process.cwd(), config.claudeConfigDir)
        : undefined;
    const credential = credentialRef(config.apiKeyEnv);
    const resolveApiKey = async () => {
        const hit = await ctx.credentials.resolve(credential);
        if (hit === undefined) {
            throw new LlmError(`dsh-claude-code: no API key resolved from ${credential}`, 'MISSING_CREDENTIAL');
        }
        return assertUsableApiKey(hit.value, 'dsh-claude-code', credential);
    };
    ctx.llm.registerAdapter([config.provider], new ClaudeCodeAdapter({
        config: () => ({ ...config, capturedSystem, ...(claudeInstructions === undefined ? {} : { claudeInstructions }) }),
        resolveApiKey,
    }));
    ctx.systemPrompt.section({
        name: 'claude-code:complete-system-prompt',
        order: -1_000,
        text: capturedSystem.prompt,
        complete: true,
    });
    ctx.systemPrompt.context({
        name: 'claude-code:current-date',
        order: -1_000,
        text: () => currentDateReminder(new Date(), config.timeZone, claudeInstructions),
    });
    ctx.systemPrompt.context({
        name: 'claude-code:agent-catalog',
        order: -999,
        text: capturedAgentContext(),
    });
    ctx.on('system-prompt/assemble', async (_assembly, _context, next) => exactToolAssembly(await next()), { prepend: true });
    const bodies = toolBodies(ctx, config);
    const expected = new Set(CLAUDE_CODE_BASELINE.tools.map(tool => tool.name));
    const extra = Object.keys(bodies).filter(tool => !expected.has(tool));
    const missing = [...expected].filter(tool => bodies[tool] === undefined);
    if (missing.length > 0 || extra.length > 0) {
        throw new Error(`dsh-claude-code tool implementation mismatch; missing [${missing.join(', ')}], extra [${extra.join(', ')}]`);
    }
    for (const tool of CLAUDE_CODE_BASELINE.tools) {
        const body = bodies[tool.name];
        if (body === undefined)
            throw new Error(`dsh-claude-code tool implementation disappeared: ${tool.name}`);
        ctx.tools.register(capturedToolDefinition(tool, body));
    }
}
//# sourceMappingURL=index.js.map