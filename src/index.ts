/** Profile-wide Claude Code compatibility surface. */

import type { Context } from '@deepseek-ai/cordis'
import { apply as applyAgentSurface } from './agent.ts'
import { Config, resolveConfig, type PluginConfig } from './config.ts'

/** Cordis plugin name. */
export const name = 'claude-code-compat'

/** The host plugin waits for optional profile-specific services itself. */
export const inject: string[] = []

export { Config, resolveConfig }
export type { PluginConfig }

/** Install the Claude surface into the DSH profile that loaded this bundle. */
export function apply(ctx: Context, rawConfig: PluginConfig = {}): void {
  ctx.provide('claudeCodeModeConfig', resolveConfig(rawConfig))
  ctx.inject(
    ['llm', 'tools', 'systemPrompt', 'claudeCodeModeConfig'],
    (surfaceCtx: Context) => applyAgentSurface(surfaceCtx),
  )
}
