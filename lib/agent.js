/** Claude Code prompt and tool surface for one installed DSH profile. */
import { resolve } from 'node:path';
import { CLAUDE_CODE_BASELINE } from "./generated/claude-code-baseline.js";
import { captureClaudeInstructions } from "./instructions.js";
import { capturedAgentContext, captureRuntimeEnvironment, currentDateReminder, materializeCapturedSystem, } from "./request.js";
import { ClaudeBackgroundTasks } from "./tools/background.js";
import { CoordinationTools } from "./tools/coordination.js";
import { coreToolBodies } from "./tools/core.js";
import { DesignSyncStore } from "./tools/design-sync.js";
import { notebookToolBodies } from "./tools/notebook.js";
import { LocalOnboardingGuides } from "./tools/onboarding.js";
import { remoteTriggerBody } from "./tools/remote-trigger.js";
import { capturedToolDefinition } from "./tools/runtime.js";
import { ClaudeTaskStore } from "./tools/tasks.js";
import { WorktreeTools } from "./tools/worktree.js";
import { ClaudeWorkspace } from "./tools/workspace.js";
/** Cordis plugin name. */
export const name = 'claude-code-agent-surface';
/** DSH capabilities used by the compatibility surface. */
export const inject = ['claudeCodeModeConfig', 'llm', 'tools', 'systemPrompt'];
/** Freeze Claude's startup-only environment once for each live agent. */
class SurfaceSnapshots {
    config;
    agents = new WeakMap();
    fallback;
    constructor(config) {
        this.config = config;
    }
    capture(cwd) {
        const instructions = this.config.loadClaudeInstructions
            ? captureClaudeInstructions(cwd, this.config.claudeConfigDir)
            : undefined;
        const system = materializeCapturedSystem(captureRuntimeEnvironment('{{model}}', cwd, `${resolve(this.config.claudeConfigDir, 'memory')}/`));
        return { system, ...(instructions === undefined ? {} : { instructions }) };
    }
    get(context) {
        const agent = context.agent;
        if (agent === undefined) {
            this.fallback ??= this.capture(process.cwd());
            return this.fallback;
        }
        const existing = this.agents.get(agent);
        if (existing !== undefined)
            return existing;
        const captured = this.capture(agent.session.header.cwd ?? process.cwd());
        this.agents.set(agent, captured);
        return captured;
    }
}
function capturedSchemas() {
    return CLAUDE_CODE_BASELINE.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: structuredClone(tool.input_schema),
    }));
}
function exactAssembly(result, snapshot, config) {
    return {
        ...result,
        contexts: [
            {
                name: 'claude-code:current-date',
                text: currentDateReminder(new Date(), config.timeZone, snapshot.instructions),
            },
            { name: 'claude-code:agent-catalog', text: capturedAgentContext() },
        ],
        tools: capturedSchemas(),
    };
}
function toolBodies(ctx, config) {
    const background = new ClaudeBackgroundTasks(ctx);
    const workspace = new ClaudeWorkspace();
    const onboarding = new LocalOnboardingGuides(config.onboardingRoot, workspace);
    return {
        ...coreToolBodies(ctx, {
            webFetchMaxTokens: config.webFetchMaxTokens,
            workspace,
        }),
        ...new ClaudeTaskStore(background).bodies(ctx),
        ...new CoordinationTools(background, workspace, onboarding).bodies(ctx),
        ...notebookToolBodies(ctx, workspace),
        ...new WorktreeTools(workspace).bodies(ctx),
        DesignSync: new DesignSyncStore(config.designRoot, workspace).body(),
        RemoteTrigger: remoteTriggerBody(config.claudeConfigDir),
    };
}
/** Register Claude's prompt and tools in the calling profile scope. */
export function apply(ctx) {
    const config = ctx.claudeCodeModeConfig;
    const snapshots = new SurfaceSnapshots(config);
    ctx.systemPrompt.section({
        name: 'claude-code:complete-system-prompt',
        order: -1_000,
        text: context => snapshots.get(context).system.prompt,
        complete: true,
    });
    ctx.on('system-prompt/assemble', async (_assembly, context, next) => exactAssembly(await next(), snapshots.get(context), config), { prepend: true });
    const bodies = toolBodies(ctx, config);
    const expected = new Set(CLAUDE_CODE_BASELINE.tools.map(tool => tool.name));
    const missing = [...expected].filter(tool => bodies[tool] === undefined);
    if (missing.length > 0) {
        throw new Error(`dsh-claude-code tool implementation mismatch; missing [${missing.join(', ')}]`);
    }
    for (const tool of CLAUDE_CODE_BASELINE.tools) {
        const body = bodies[tool.name];
        if (body === undefined)
            throw new Error(`dsh-claude-code tool implementation disappeared: ${tool.name}`);
        ctx.tools.register(capturedToolDefinition(tool, body));
    }
}
//# sourceMappingURL=agent.js.map