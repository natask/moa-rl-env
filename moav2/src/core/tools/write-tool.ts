import { getPlatform } from '../platform'
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { logAction } from '../services/action-logger'

export function createWriteTool(): AgentTool<any, any> {
  return {
    name: 'write',
    label: 'Write File',
    description: 'Write content to a file at the given path. Creates parent directories if needed.',
    parameters: Type.Object({
      path: Type.String({ description: 'Absolute path to the file to write' }),
      content: Type.String({ description: 'Content to write to the file' }),
    }),
    execute: async (toolCallId, params) => {
      try {
        const { fs, path } = getPlatform()
        const dir = path.dirname(params.path)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(params.path, params.content)
        logAction('tool.write', { path: params.path, bytesWritten: params.content.length }, { actor: 'agent' })
        return {
          content: [{ type: 'text', text: `Wrote ${params.content.length} bytes to ${params.path}` }],
          details: { path: params.path, bytesWritten: params.content.length },
        }
      } catch (e: any) {
        return {
          content: [{ type: 'text', text: `Error writing file: ${e.message}` }],
          details: { error: e.message },
        }
      }
    },
  }
}
