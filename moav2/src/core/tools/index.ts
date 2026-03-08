import { createReadTool } from './read-tool'
import { createWriteTool } from './write-tool'
import { createEditTool } from './edit-tool'
import { createBashTool } from './bash-tool'
import { createSearchTool } from './search-tool'
import { createSelfEditTool } from './self-edit-tool'
import { createWebFetchTool } from './web-fetch-tool'
import { createIntentTool } from './intent-tool'
import { createHistoryTool } from './history-tool'
import { createRuntimePackTool } from './runtime-pack-tool'
import { createSetSystemPromptTool } from './set-system-prompt-tool'
import type { AgentTool } from '@mariozechner/pi-agent-core'

export function createAllTools(moaSrcPath: string = '/src'): AgentTool<any, any>[] {
  return [
    createReadTool(),
    createWriteTool(),
    createEditTool(),
    createBashTool(),
    createSearchTool(),
    createSelfEditTool(moaSrcPath),
    createWebFetchTool(),
    createIntentTool(),
    createHistoryTool(),
    createRuntimePackTool(),
  ]
}

export {
  createReadTool,
  createWriteTool,
  createEditTool,
  createBashTool,
  createSearchTool,
  createSelfEditTool,
  createWebFetchTool,
  createIntentTool,
  createHistoryTool,
  createRuntimePackTool,
  createSetSystemPromptTool,
}
