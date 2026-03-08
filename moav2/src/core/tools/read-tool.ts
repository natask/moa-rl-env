import { getPlatform } from '../platform'
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { logAction } from '../services/action-logger'

export function createReadTool(): AgentTool<any, any> {
  return {
    name: 'read',
    label: 'Read File',
    description: 'Read the contents of a file at the given path.',
    parameters: Type.Object({
      path: Type.String({ description: 'Absolute path to the file to read' }),
    }),
    execute: async (toolCallId, params) => {
      try {
        const { fs } = getPlatform()
        const content = fs.readFileSync(params.path, 'utf-8')
        logAction('tool.read', { path: params.path, bytesRead: content.length }, { actor: 'agent' })
        return {
          content: [{ type: 'text', text: content }],
          details: { path: params.path, size: content.length },
        }
      } catch (e: any) {
        return {
          content: [{ type: 'text', text: `Error reading file: ${e.message}` }],
          details: { error: e.message },
        }
      }
    },
  }
}
