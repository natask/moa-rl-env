import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { runtimePackService } from '../services/runtime-pack'
import { logAction } from '../services/action-logger'

export function createRuntimePackTool(): AgentTool<any, any> {
  return {
    name: 'runtime_pack',
    label: 'Runtime Pack',
    description: 'Inspect, activate, rollback, and execute scripts from runtime packs.',
    parameters: Type.Object({
      action: Type.String({ description: 'One of: info, list_scripts, run_script, activate, rollback' }),
      script: Type.Optional(Type.String({ description: 'Script name for run_script' })),
      packId: Type.Optional(Type.String({ description: 'Pack id for activate' })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        switch (params.action) {
          case 'info': {
            const info = runtimePackService.getInfoSync()
            return {
              content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
              details: info,
            }
          }
          case 'list_scripts': {
            const info = runtimePackService.getInfoSync()
            const config = runtimePackService.getActiveConfigSync()
            const scripts = config?.scripts ?? {}
            const names = Object.keys(scripts)
            const lines = names.length > 0
              ? names.map((name) => {
                  const script = scripts[name]
                  return `${name}: ${script.type} -> ${script.command}`
                })
              : ['(no runtime scripts)']
            return {
              content: [{ type: 'text', text: `Active pack: ${info.activePackId ?? '(none)'}\n${lines.join('\n')}` }],
              details: { activePackId: info.activePackId, scripts: names },
            }
          }
          case 'run_script': {
            if (!params.script) {
              return {
                content: [{ type: 'text', text: 'Error: script is required for run_script' }],
                details: { error: 'missing_script' },
              }
            }
            const result = await runtimePackService.executeScript(params.script)
            logAction('tool.runtime_pack.run_script', {
              script: params.script,
              ok: result.ok,
              packId: result.packId,
            }, { actor: 'agent' })
            return {
              content: [{ type: 'text', text: result.output }],
              details: { ok: result.ok, packId: result.packId, script: params.script },
            }
          }
          case 'activate': {
            if (!params.packId) {
              return {
                content: [{ type: 'text', text: 'Error: packId is required for activate' }],
                details: { error: 'missing_packId' },
              }
            }
            const ok = runtimePackService.activatePackSync(params.packId)
            logAction('tool.runtime_pack.activate', { packId: params.packId, ok }, { actor: 'agent' })
            return {
              content: [{ type: 'text', text: ok ? `Activated pack: ${params.packId}` : `Failed to activate pack: ${params.packId}` }],
              details: { packId: params.packId, ok },
            }
          }
          case 'rollback': {
            const ok = runtimePackService.rollbackSync()
            logAction('tool.runtime_pack.rollback', { ok }, { actor: 'agent' })
            return {
              content: [{ type: 'text', text: ok ? 'Rolled back to previous runtime pack.' : 'No previous runtime pack to roll back to.' }],
              details: { ok },
            }
          }
          default:
            return {
              content: [{ type: 'text', text: `Unknown action: ${params.action}` }],
              details: { error: 'unknown_action' },
            }
        }
      } catch (e: any) {
        return {
          content: [{ type: 'text', text: `Runtime pack error: ${e.message}` }],
          details: { error: e.message },
        }
      }
    },
  }
}
