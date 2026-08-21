/** Host-plane registration for the independent Claude Code agent mode. */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { apply as applyAgentSurface } from './agent.ts'
import { Config, resolveConfig, type PluginConfig } from './config.ts'

/** Cordis plugin name. */
export const name = 'claude-code-mode'

/** The host plugin waits for optional profile-specific services itself. */
export const inject: string[] = []

export { Config, resolveConfig }
export type { PluginConfig }

const PRESET_ROOT = fileURLToPath(new URL('../presets', import.meta.url))

interface AgentPresetRegistry {
  registerRoot(registration: { readonly id: string; readonly path: string }): () => void
}

function presetRegistry(ctx: Context): AgentPresetRegistry {
  const service = (ctx as unknown as { get(name: string): unknown }).get('agentPresets')
  if (
    typeof service !== 'object'
    || service === null
    || !('registerRoot' in service)
    || typeof service.registerRoot !== 'function'
  ) {
    throw new Error(
      'dsh-claude-code: this DSH Web version cannot register plugin-provided agent presets; upgrade DSH',
    )
  }
  return service as AgentPresetRegistry
}

/** Register the Web preset and retain the same surface for the headless profile. */
export function apply(ctx: Context, rawConfig: PluginConfig = {}): void {
  ctx.provide('claudeCodeModeConfig', resolveConfig(rawConfig))

  ctx.inject(['agentPresets'], (presetCtx: Context) => {
    presetRegistry(presetCtx).registerRoot({ id: 'dsh-claude-code', path: PRESET_ROOT })
  })

  ctx.inject(
    ['headlessStartup', 'llm', 'tools', 'systemPrompt', 'claudeCodeModeConfig'],
    (headlessCtx: Context) => applyAgentSurface(headlessCtx),
  )
}
