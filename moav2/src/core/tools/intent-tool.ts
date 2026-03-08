import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'

interface Intent {
  id: string
  description: string
  status: 'active' | 'completed' | 'abandoned'
  context: string
  createdAt: number
  updatedAt: number
  relatedIntents?: string[]
}

// HMR-safe intent storage: survives hot module reloads during development
const _w = window as any
if (!_w.__moaIntentStore) _w.__moaIntentStore = new Map<string, Intent>()
const intentStore: Map<string, Intent> = _w.__moaIntentStore

function generateId(): string {
  return `intent-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

function formatIntent(i: Intent): string {
  const age = Math.round((Date.now() - i.createdAt) / 1000)
  const ageStr = age < 60 ? `${age}s ago` : age < 3600 ? `${Math.round(age / 60)}m ago` : `${Math.round(age / 3600)}h ago`
  let line = `[${i.id}] (${i.status}) ${i.description}  -- created ${ageStr}`
  if (i.context) line += `\n  Context: ${i.context}`
  if (i.relatedIntents?.length) line += `\n  Related: ${i.relatedIntents.join(', ')}`
  return line
}

export function createIntentTool(): AgentTool<any, any> {
  return {
    name: 'intent',
    label: 'Manage Intent',
    description:
      'Record, recall, and manage user intents. Use this to track what the user wants to accomplish, ' +
      'update progress, and maintain continuity across the conversation.\n' +
      'Actions: "declare" (new intent), "update" (change details), "list" (show all), ' +
      '"recall" (get specific), "complete" (mark done), "abandon" (mark abandoned).',
    parameters: Type.Object({
      action: Type.String({
        description: 'Action: "declare", "update", "list", "recall", "complete", "abandon"',
      }),
      description: Type.Optional(Type.String({ description: 'Intent description (for declare/update)' })),
      intentId: Type.Optional(Type.String({ description: 'Intent ID (for update/recall/complete/abandon)' })),
      context: Type.Optional(Type.String({ description: 'Additional context or notes' })),
      relatedIntents: Type.Optional(
        Type.Array(Type.String(), { description: 'IDs of related intents (for declare/update)' })
      ),
    }),
    execute: async (_toolCallId, params) => {
      try {
        switch (params.action) {
          case 'declare': {
            if (!params.description) {
              return {
                content: [{ type: 'text', text: 'Error: "description" is required for declare action.' }],
                details: {},
              }
            }
            const id = generateId()
            const intent: Intent = {
              id,
              description: params.description,
              status: 'active',
              context: params.context || '',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              relatedIntents: params.relatedIntents,
            }
            intentStore.set(id, intent)
            return {
              content: [{ type: 'text', text: `Intent declared: ${formatIntent(intent)}` }],
              details: { intent },
            }
          }

          case 'list': {
            const intents = Array.from(intentStore.values()).sort((a, b) => b.updatedAt - a.updatedAt)
            if (intents.length === 0) {
              return {
                content: [{ type: 'text', text: 'No intents recorded yet.' }],
                details: { count: 0 },
              }
            }
            const active = intents.filter((i) => i.status === 'active')
            const completed = intents.filter((i) => i.status === 'completed')
            const abandoned = intents.filter((i) => i.status === 'abandoned')

            let text = ''
            if (active.length > 0) text += `== Active (${active.length}) ==\n${active.map(formatIntent).join('\n\n')}\n\n`
            if (completed.length > 0) text += `== Completed (${completed.length}) ==\n${completed.map(formatIntent).join('\n\n')}\n\n`
            if (abandoned.length > 0) text += `== Abandoned (${abandoned.length}) ==\n${abandoned.map(formatIntent).join('\n\n')}\n\n`

            return {
              content: [{ type: 'text', text: text.trim() }],
              details: { count: intents.length, active: active.length, completed: completed.length, abandoned: abandoned.length },
            }
          }

          case 'recall': {
            if (!params.intentId) {
              return {
                content: [{ type: 'text', text: 'Error: "intentId" is required for recall action.' }],
                details: {},
              }
            }
            const intent = intentStore.get(params.intentId)
            if (!intent) {
              return {
                content: [{ type: 'text', text: `Intent not found: ${params.intentId}` }],
                details: {},
              }
            }
            return {
              content: [{ type: 'text', text: JSON.stringify(intent, null, 2) }],
              details: { intent },
            }
          }

          case 'update': {
            if (!params.intentId) {
              return {
                content: [{ type: 'text', text: 'Error: "intentId" is required for update action.' }],
                details: {},
              }
            }
            const intent = intentStore.get(params.intentId)
            if (!intent) {
              return {
                content: [{ type: 'text', text: `Intent not found: ${params.intentId}` }],
                details: {},
              }
            }
            if (params.description) intent.description = params.description
            if (params.context) intent.context = params.context
            if (params.relatedIntents) intent.relatedIntents = params.relatedIntents
            intent.updatedAt = Date.now()
            return {
              content: [{ type: 'text', text: `Intent updated: ${formatIntent(intent)}` }],
              details: { intent },
            }
          }

          case 'complete': {
            if (!params.intentId) {
              return {
                content: [{ type: 'text', text: 'Error: "intentId" is required for complete action.' }],
                details: {},
              }
            }
            const intent = intentStore.get(params.intentId)
            if (!intent) {
              return {
                content: [{ type: 'text', text: `Intent not found: ${params.intentId}` }],
                details: {},
              }
            }
            intent.status = 'completed'
            intent.updatedAt = Date.now()
            if (params.context) intent.context = params.context
            return {
              content: [{ type: 'text', text: `Intent completed: ${formatIntent(intent)}` }],
              details: { intent },
            }
          }

          case 'abandon': {
            if (!params.intentId) {
              return {
                content: [{ type: 'text', text: 'Error: "intentId" is required for abandon action.' }],
                details: {},
              }
            }
            const intent = intentStore.get(params.intentId)
            if (!intent) {
              return {
                content: [{ type: 'text', text: `Intent not found: ${params.intentId}` }],
                details: {},
              }
            }
            intent.status = 'abandoned'
            intent.updatedAt = Date.now()
            if (params.context) intent.context = params.context
            return {
              content: [{ type: 'text', text: `Intent abandoned: ${formatIntent(intent)}` }],
              details: { intent },
            }
          }

          default:
            return {
              content: [
                {
                  type: 'text',
                  text: `Unknown action: "${params.action}". Valid actions: declare, list, recall, update, complete, abandon`,
                },
              ],
              details: {},
            }
        }
      } catch (e: any) {
        return {
          content: [{ type: 'text', text: `Intent error: ${e.message}` }],
          details: { error: e.message },
        }
      }
    },
  }
}
