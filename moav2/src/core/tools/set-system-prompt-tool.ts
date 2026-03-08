import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'

interface SetSystemPromptToolConfig {
  applySystemPrompt: (prompt: string) => Promise<void>
}

export function createSetSystemPromptTool(config: SetSystemPromptToolConfig): AgentTool<any, any> {
  return {
    name: 'set_system_prompt',
    label: 'Set System Prompt',
    description: 'Update the current session system prompt for future responses.',
    parameters: Type.Object({
      prompt: Type.String({ description: 'The full system prompt to apply.' }),
    }),
    execute: async (_toolCallId, params) => {
      const prompt = params.prompt?.trim()
      if (!prompt) {
        return {
          content: [{ type: 'text', text: 'Error: prompt is required.' }],
          details: { ok: false, error: 'missing_prompt' },
        }
      }

      await config.applySystemPrompt(prompt)
      return {
        content: [{ type: 'text', text: 'System prompt updated for this session.' }],
        details: { ok: true },
      }
    },
  }
}
