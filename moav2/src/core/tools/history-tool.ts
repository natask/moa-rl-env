import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { db, dbReady } from '../services/db'

export function createHistoryTool(): AgentTool<any, any> {
  return {
    name: 'history',
    label: 'Conversation History',
    description:
      'Browse and search conversation history across all sessions. ' +
      'Actions: "list_sessions" (list all sessions with titles/dates), ' +
      '"get_session" (get messages from a specific session by sessionId), ' +
      '"search_all" (search across all session messages for a query), ' +
      '"get_recent" (get the N most recent messages across all sessions).',
    parameters: Type.Object({
      action: Type.String({
        description: 'Action: "list_sessions", "get_session", "search_all", "get_recent"',
      }),
      sessionId: Type.Optional(Type.String({ description: 'Session ID (required for get_session)' })),
      query: Type.Optional(Type.String({ description: 'Search query (required for search_all)' })),
      count: Type.Optional(Type.Number({ description: 'Number of results to return (default: 20, used by get_recent and search_all)' })),
    }),
    execute: async (_toolCallId, params) => {
      try {
        await dbReady

        switch (params.action) {
          case 'list_sessions': {
            const sessions = await db.listSessions()
            if (sessions.length === 0) {
              return {
                content: [{ type: 'text', text: 'No conversation sessions found.' }],
                details: { count: 0 },
              }
            }

            const lines = sessions.map((s) => {
              const created = new Date(s.createdAt).toISOString().slice(0, 16)
              const updated = new Date(s.updatedAt).toISOString().slice(0, 16)
              return `[${s.id}] "${s.title}" (model: ${s.model || 'unknown'})\n  Created: ${created}  Updated: ${updated}`
            })

            return {
              content: [{ type: 'text', text: `${sessions.length} session(s):\n\n${lines.join('\n\n')}` }],
              details: { count: sessions.length },
            }
          }

          case 'get_session': {
            if (!params.sessionId) {
              return {
                content: [{ type: 'text', text: 'Error: "sessionId" is required for get_session action.' }],
                details: {},
              }
            }

            const session = await db.getSession(params.sessionId)
            if (!session) {
              return {
                content: [{ type: 'text', text: `Session not found: ${params.sessionId}` }],
                details: {},
              }
            }

            const messages = await db.getMessages(params.sessionId)
            if (messages.length === 0) {
              return {
                content: [{ type: 'text', text: `Session "${session.title}" exists but has no messages.` }],
                details: { session },
              }
            }

            const lines = messages
              .filter((m) => !m.partial)
              .map((m) => {
                const time = new Date(m.createdAt).toISOString().slice(0, 16)
                const content = m.content || ''
                const snippet = content.length > 500 ? content.substring(0, 500) + '...' : content
                return `[${time}] ${m.role}: ${snippet}`
              })

            return {
              content: [{
                type: 'text',
                text: `Session "${session.title}" (${messages.length} messages):\n\n${lines.join('\n\n')}`,
              }],
              details: { session, messageCount: messages.length },
            }
          }

          case 'search_all': {
            if (!params.query) {
              return {
                content: [{ type: 'text', text: 'Error: "query" is required for search_all action.' }],
                details: {},
              }
            }

            const maxResults = params.count || 20
            const query = params.query.toLowerCase()
            const sessions = await db.listSessions()
            const results: string[] = []

            for (const session of sessions) {
              if (results.length >= maxResults) break
              const messages = await db.getMessages(session.id)
              for (const msg of messages) {
                if (results.length >= maxResults) break
                if (msg.partial) continue
                const content = msg.content || ''
                if (content.toLowerCase().includes(query)) {
                  const date = new Date(msg.createdAt).toISOString().slice(0, 16)
                  const snippet = content.length > 300 ? content.substring(0, 300) + '...' : content
                  results.push(`[${date}] Session "${session.title}" (${session.id}) [${msg.role}]:\n  ${snippet}`)
                }
              }
            }

            if (results.length === 0) {
              return {
                content: [{ type: 'text', text: `No matches for "${params.query}" across all sessions.` }],
                details: { query: params.query, matchCount: 0 },
              }
            }

            return {
              content: [{
                type: 'text',
                text: `Found ${results.length} match(es) for "${params.query}":\n\n${results.join('\n\n')}`,
              }],
              details: { query: params.query, matchCount: results.length },
            }
          }

          case 'get_recent': {
            const count = params.count || 20
            const sessions = await db.listSessions()

            // Collect all non-partial messages across sessions, then sort by time and take most recent
            const allMessages: Array<{ sessionTitle: string; sessionId: string; role: string; content: string; createdAt: number }> = []

            for (const session of sessions) {
              const messages = await db.getMessages(session.id)
              for (const msg of messages) {
                if (msg.partial) continue
                allMessages.push({
                  sessionTitle: session.title,
                  sessionId: session.id,
                  role: msg.role,
                  content: msg.content || '',
                  createdAt: msg.createdAt,
                })
              }
            }

            // Sort by most recent first
            allMessages.sort((a, b) => b.createdAt - a.createdAt)
            const recent = allMessages.slice(0, count)

            if (recent.length === 0) {
              return {
                content: [{ type: 'text', text: 'No messages found across any sessions.' }],
                details: { count: 0 },
              }
            }

            const lines = recent.map((m) => {
              const date = new Date(m.createdAt).toISOString().slice(0, 16)
              const snippet = m.content.length > 300 ? m.content.substring(0, 300) + '...' : m.content
              return `[${date}] Session "${m.sessionTitle}" [${m.role}]:\n  ${snippet}`
            })

            return {
              content: [{
                type: 'text',
                text: `${recent.length} most recent message(s):\n\n${lines.join('\n\n')}`,
              }],
              details: { count: recent.length },
            }
          }

          default:
            return {
              content: [{
                type: 'text',
                text: `Unknown action: "${params.action}". Valid actions: list_sessions, get_session, search_all, get_recent`,
              }],
              details: {},
            }
        }
      } catch (e: any) {
        return {
          content: [{ type: 'text', text: `History error: ${e.message}` }],
          details: { error: e.message },
        }
      }
    },
  }
}
