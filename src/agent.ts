/** Claude Code prompt and tool surface for one installed DSH profile. */

import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type { ResolvedConfig } from './config.ts'
import { CLAUDE_CODE_BASELINE } from './generated/claude-code-baseline.ts'
import { captureClaudeInstructions } from './instructions.ts'
import {
  capturedAgentContext,
  captureRuntimeEnvironment,
  currentDateReminder,
  materializeCapturedSystem,
  type MaterializedClaudeSystem,
} from './request.ts'
import { ClaudeBackgroundTasks } from './tools/background.ts'
import { CoordinationTools } from './tools/coordination.ts'
import { coreToolBodies } from './tools/core.ts'
import { DesignSyncStore } from './tools/design-sync.ts'
import { notebookToolBodies } from './tools/notebook.ts'
import { LocalOnboardingGuides } from './tools/onboarding.ts'
import { remoteTriggerBody } from './tools/remote-trigger.ts'
import { capturedToolDefinition, type ClaudeToolBody } from './tools/runtime.ts'
import { ClaudeTaskStore } from './tools/tasks.ts'
import { WorktreeTools } from './tools/worktree.ts'
import { ClaudeWorkspace } from './tools/workspace.ts'

/** Cordis plugin name. */
export const name = 'claude-code-agent-surface'

/** DSH capabilities used by the compatibility surface. */
export const inject = ['claudeCodeModeConfig', 'llm', 'tools', 'systemPrompt']

interface SurfaceSnapshot {
  readonly system: MaterializedClaudeSystem
  readonly instructions?: string
}

type AgentAssemblyContext = AssembleContext & { readonly agent?: Agent }

/** Freeze Claude's startup-only environment once for each live agent. */
class SurfaceSnapshots {
  private readonly agents = new WeakMap<Agent, SurfaceSnapshot>()
  private fallback: SurfaceSnapshot | undefined

  constructor(private readonly config: ResolvedConfig) {}

  private capture(cwd: string): SurfaceSnapshot {
    const instructions = this.config.loadClaudeInstructions
      ? captureClaudeInstructions(cwd, this.config.claudeConfigDir)
      : undefined
    const system = materializeCapturedSystem(captureRuntimeEnvironment(
      '{{model}}',
      cwd,
      `${resolve(this.config.claudeConfigDir, 'memory')}/`,
    ))
    return { system, ...(instructions === undefined ? {} : { instructions }) }
  }

  get(context: AgentAssemblyContext): SurfaceSnapshot {
    const agent = context.agent
    if (agent === undefined) {
      this.fallback ??= this.capture(process.cwd())
      return this.fallback
    }
    const existing = this.agents.get(agent)
    if (existing !== undefined) return existing
    const captured = this.capture(agent.session.header.cwd ?? process.cwd())
    this.agents.set(agent, captured)
    return captured
  }
}

function capturedSchemas(): ToolSchema[] {
  return CLAUDE_CODE_BASELINE.tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: structuredClone(tool.input_schema) as Record<string, unknown>,
  }))
}

function exactAssembly(
  result: PromptAssembly,
  snapshot: SurfaceSnapshot,
  config: ResolvedConfig,
): PromptAssembly {
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
  }
}

function toolBodies(ctx: Context, config: ResolvedConfig): Record<string, ClaudeToolBody> {
  const background = new ClaudeBackgroundTasks(ctx)
  const workspace = new ClaudeWorkspace()
  const onboarding = new LocalOnboardingGuides(config.onboardingRoot, workspace)
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
  }
}

/** Register Claude's prompt and tools in the calling profile scope. */
export function apply(ctx: Context): void {
  const config = ctx.claudeCodeModeConfig
  const snapshots = new SurfaceSnapshots(config)

  ctx.systemPrompt.section({
    name: 'claude-code:complete-system-prompt',
    order: -1_000,
    text: context => snapshots.get(context).system.prompt,
    complete: true,
  })
  ctx.on(
    'system-prompt/assemble',
    async (_assembly, context, next) => exactAssembly(await next(), snapshots.get(context), config),
    { prepend: true },
  )

  const bodies = toolBodies(ctx, config)
  const expected = new Set<string>(CLAUDE_CODE_BASELINE.tools.map(tool => tool.name))
  const missing = [...expected].filter(tool => bodies[tool] === undefined)
  if (missing.length > 0) {
    throw new Error(`dsh-claude-code tool implementation mismatch; missing [${missing.join(', ')}]`)
  }
  for (const tool of CLAUDE_CODE_BASELINE.tools) {
    const body = bodies[tool.name]
    if (body === undefined) throw new Error(`dsh-claude-code tool implementation disappeared: ${tool.name}`)
    ctx.tools.register(capturedToolDefinition(tool, body))
  }
}
