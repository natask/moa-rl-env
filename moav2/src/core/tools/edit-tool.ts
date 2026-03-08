import { getPlatform } from '../platform'
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { logAction } from '../services/action-logger'

export function createEditTool(): AgentTool<any, any> {
  return {
    name: 'edit',
    label: 'Edit File',
    description: 'Replace a specific string in a file with a new string.',
    parameters: Type.Object({
      path: Type.String({ description: 'Absolute path to the file to edit' }),
      old_string: Type.String({ description: 'The exact string to find and replace' }),
      new_string: Type.String({ description: 'The replacement string' }),
    }),
    execute: async (toolCallId, params) => {
      try {
        const { fs } = getPlatform()
        const content = fs.readFileSync(params.path, 'utf-8')
        const idx = content.indexOf(params.old_string)
        if (idx === -1) {
          return {
            content: [{ type: 'text', text: `Error: old_string not found in ${params.path}` }],
            details: { error: 'old_string not found' },
          }
        }
        const newContent = content.substring(0, idx) + params.new_string + content.substring(idx + params.old_string.length)
        fs.writeFileSync(params.path, newContent)
        logAction('tool.edit', {
          path: params.path,
          oldLength: params.old_string.length,
          newLength: params.new_string.length,
        }, { actor: 'agent' })
        return {
          content: [{ type: 'text', text: `Edited ${params.path}: replaced ${params.old_string.length} chars with ${params.new_string.length} chars` }],
          details: { path: params.path },
        }
      } catch (e: any) {
        return {
          content: [{ type: 'text', text: `Error editing file: ${e.message}` }],
          details: { error: e.message },
        }
      }
    },
  }
}
