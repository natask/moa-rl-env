import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { logAction } from '../services/action-logger'

const MAX_CONTENT_LENGTH = 50000

export function createWebFetchTool(): AgentTool<any, any> {
  return {
    name: 'web_fetch',
    label: 'Fetch Web Page',
    description:
      'Fetch a web page URL and return its readable text content. ' +
      'Use this to search the web (e.g., fetch a DuckDuckGo or Google search URL) or read any web page.',
    parameters: Type.Object({
      url: Type.String({ description: 'The URL to fetch and read' }),
    }),
    execute: async (toolCallId, params) => {
      try {
        const response = await fetch(params.url)
        const html = await response.text()

        // Strip scripts, styles, and HTML tags to get readable text
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, ' ')
          .trim()

        const content = text.length > MAX_CONTENT_LENGTH
          ? text.substring(0, MAX_CONTENT_LENGTH) + `\n\n[Content truncated at ${MAX_CONTENT_LENGTH} characters]`
          : text

        logAction('tool.web_fetch', {
          url: params.url,
          statusCode: response.status,
          bytesReceived: text.length,
        }, { actor: 'agent' })

        return {
          content: [{ type: 'text', text: content }],
          details: { url: params.url, finalUrl: response.url, length: text.length },
        }
      } catch (e: any) {
        return {
          content: [{ type: 'text', text: `Failed to fetch ${params.url}: ${e.message || e}` }],
          details: { url: params.url, error: e.message || String(e) },
        }
      }
    },
  }
}
