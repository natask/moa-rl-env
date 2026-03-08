import { getPlatform } from '../platform'
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { logAction } from '../services/action-logger'

export function createBashTool(): AgentTool<any, any> {
  return {
    name: 'bash',
    label: 'Execute Command',
    description: 'Execute a shell command and return its output.',
    parameters: Type.Object({
      command: Type.String({ description: 'The shell command to execute' }),
    }),
    execute: async (toolCallId, params) => {
      try {
        const { process: proc } = getPlatform()
        const result = await proc.exec(params.command, { timeout: 30000, maxBuffer: 1024 * 1024 })
        logAction('tool.bash', {
          command: params.command,
          exitCode: result.exitCode,
          outputLength: result.stdout.length,
        }, { actor: 'agent' })

        if (result.exitCode !== 0) {
          return {
            content: [{ type: 'text', text: `stdout:\n${result.stdout}\nstderr:\n${result.stderr}` }],
            details: { command: params.command, exitCode: result.exitCode, error: result.stderr },
          }
        }
        return {
          content: [{ type: 'text', text: result.stdout }],
          details: { command: params.command, exitCode: 0 },
        }
      } catch (e: any) {
        return {
          content: [{ type: 'text', text: `Error: ${e.message}` }],
          details: { command: params.command, exitCode: 1, error: e.message },
        }
      }
    },
  }
}
