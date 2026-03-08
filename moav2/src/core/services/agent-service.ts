import { Agent } from '@mariozechner/pi-agent-core'
import type { AgentEvent, AgentTool, AgentMessage } from '@mariozechner/pi-agent-core'
import type { Model } from '@mariozechner/pi-ai'
import { createAllTools } from './tools/index'

export interface AgentConfig {
  model: Model<any>
  tools?: AgentTool<any, any>[]
  systemPrompt?: string
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined
}

export interface StreamingBlock {
  id: string
  type: 'text' | 'tool' | 'thinking'
  content?: string
  toolCallId?: string
  toolName?: string
  args?: Record<string, any>
  status?: 'running' | 'completed' | 'error'
  result?: string
}

let _blockCounter = 0
function nextBlockId() {
  return `blk-${++_blockCounter}-${Date.now()}`
}

export class AgentService {
  private agents: Map<string, Agent> = new Map()
  private subscribers: Map<string, Set<(event: AgentEvent) => void>> = new Map()
  private streamingBuffers: Set<string> = new Set()
  // Accumulates streaming blocks so UI can recover on remount
  private streamingBlocks: Map<string, StreamingBlock[]> = new Map()
  // Tracks partial DB message IDs — survives component remounts
  private partialMsgIds: Map<string, string> = new Map()

  createAgent(bufferId: string, config: AgentConfig): Agent {
    if (this.agents.has(bufferId)) {
      return this.agents.get(bufferId)!
    }

    const agent = new Agent({
      getApiKey: config.getApiKey,
    })

    agent.setModel(config.model)
    // Web fetch support matrix:
    // - Anthropic (API key/OAuth): supported via tool use.
    // - OpenAI (API key/OAuth): supported via function/tool calling.
    // - Vertex AI / Vertex Express: supported via function/tool calling.
    // - Custom OpenAI-compatible providers: supported when they implement tool calling.
    agent.setTools(config.tools ?? createAllTools())

    if (config.systemPrompt) {
      agent.setSystemPrompt(config.systemPrompt)
    }

    agent.subscribe((event: AgentEvent) => {
      if (event.type === 'agent_start') {
        this.streamingBuffers.add(bufferId)
        this.streamingBlocks.set(bufferId, [])
      }

      // Accumulate blocks in the service so UI can recover on remount
      this.accumulateBlock(bufferId, event)

      // Notify subscribers BEFORE clearing state on agent_end
      // so they can read the final blocks
      const subs = this.subscribers.get(bufferId)
      if (subs) {
        for (const fn of subs) {
          fn(event)
        }
      }

      // Clean up streaming state AFTER notifying subscribers
      if (event.type === 'agent_end') {
        this.streamingBuffers.delete(bufferId)
        this.streamingBlocks.delete(bufferId)
      }
    })

    this.agents.set(bufferId, agent)
    return agent
  }

  getAgent(bufferId: string): Agent | undefined {
    return this.agents.get(bufferId)
  }

  /**
   * Hot-swap the model on an existing agent without destroying it.
   * Preserves conversation history, tools, subscriptions, and streaming state.
   * Also updates the getApiKey callback if the auth method changed.
   */
  updateModel(bufferId: string, model: Model<any>, getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined): void {
    const agent = this.agents.get(bufferId)
    if (!agent) {
      throw new Error(`No agent for buffer ${bufferId} — cannot update model`)
    }
    agent.setModel(model)
    if (getApiKey) {
      agent.getApiKey = getApiKey
    }
  }

  destroyAgent(bufferId: string): void {
    const agent = this.agents.get(bufferId)
    if (agent) {
      agent.abort()
      this.agents.delete(bufferId)
      this.subscribers.delete(bufferId)
      this.streamingBlocks.delete(bufferId)
      this.streamingBuffers.delete(bufferId)
      this.partialMsgIds.delete(bufferId)
    }
  }

  /** Clean up agents for sessions that no longer exist */
  pruneAgents(activeSessionIds: Set<string>): void {
    for (const bufferId of this.agents.keys()) {
      if (!activeSessionIds.has(bufferId) && !this.streamingBuffers.has(bufferId)) {
        this.destroyAgent(bufferId)
      }
    }
  }

  async prompt(bufferId: string, message: string, images?: { type: 'image'; data: string; mimeType: string }[]): Promise<void> {
    const agent = this.agents.get(bufferId)
    if (!agent) {
      throw new Error(`No agent for buffer ${bufferId}`)
    }
    await agent.prompt(message, images)
  }

  steer(bufferId: string, message: string): void {
    const agent = this.agents.get(bufferId)
    if (!agent) {
      throw new Error(`No agent for buffer ${bufferId}`)
    }

    // Snapshot current streaming blocks before steering
    // This allows UI to split the output at the interruption point
    const currentBlocks = this.streamingBlocks.get(bufferId)
    if (currentBlocks && currentBlocks.length > 0) {
      // Emit a custom event so UI can capture the "before" blocks
      const subs = this.subscribers.get(bufferId)
      if (subs) {
        for (const fn of subs) {
          fn({ type: 'steer_interrupt', blocks: [...currentBlocks] } as any)
        }
      }
      // Clear streaming blocks - new content after steer will be fresh
      this.streamingBlocks.set(bufferId, [])
    }

    agent.steer({
      role: 'user',
      content: [{ type: 'text', text: message }],
      timestamp: Date.now(),
    })
  }

  isStreaming(bufferId: string): boolean {
    return this.streamingBuffers.has(bufferId)
  }

  // Returns a snapshot of in-progress streaming blocks for a buffer.
  // Used by UI to recover state after remount.
  getStreamingBlocks(bufferId: string): StreamingBlock[] {
    return this.streamingBlocks.get(bufferId) || []
  }

  // Partial message ID tracking — stored here so it survives component remounts
  setPartialMsgId(bufferId: string, id: string): void {
    this.partialMsgIds.set(bufferId, id)
  }
  getPartialMsgId(bufferId: string): string | null {
    return this.partialMsgIds.get(bufferId) || null
  }
  clearPartialMsgId(bufferId: string): void {
    this.partialMsgIds.delete(bufferId)
  }

  // Hydrate agent with prior conversation from DB messages.
  // Only injects if agent has empty history (fresh creation, not HMR).
  hydrateFromMessages(bufferId: string, dbMessages: { role: string; content: string }[]): void {
    const agent = this.agents.get(bufferId)
    if (!agent) return
    // Don't overwrite existing history (agent survived HMR and already has context)
    // Only return if we have actual user/assistant messages.
    // If we only have a system message (from initialization), we should still hydrate.
    const hasConversationHistory = agent.state.messages.some(m => (m.role as string) !== 'system')
    if (hasConversationHistory) return

    const agentMessages: AgentMessage[] = []
    for (const m of dbMessages) {
      if (m.role === 'user') {
        agentMessages.push({
          role: 'user',
          content: m.content,
          timestamp: Date.now(),
        } as AgentMessage)
      } else if (m.role === 'assistant' && m.content) {
        // Inject assistant messages as simplified text so the agent knows its own prior responses.
        // Cast via unknown because we're constructing a minimal AssistantMessage shape.
        agentMessages.push({
          role: 'assistant',
          content: [{ type: 'text', text: m.content }],
          api: 'anthropic',
          provider: 'anthropic',
          model: 'unknown',
          usage: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          stopReason: 'stop',
          timestamp: Date.now(),
        } as unknown as AgentMessage)
      }
    }
    if (agentMessages.length > 0) {
      agent.replaceMessages(agentMessages)
    }
  }

  private accumulateBlock(bufferId: string, event: AgentEvent): void {
    const blocks = this.streamingBlocks.get(bufferId)
    if (!blocks) return

    const ae = event as any
    switch (event.type) {
      case 'message_update': {
        const assistantEvent = ae.assistantMessageEvent
        if (!assistantEvent) break

        if (assistantEvent.type === 'thinking_start') {
          blocks.push({ id: nextBlockId(), type: 'thinking', content: '' })
          break
        }

        if (assistantEvent.type === 'thinking_delta') {
          const last = blocks[blocks.length - 1]
          if (last && last.type === 'thinking') {
            last.content = (last.content || '') + assistantEvent.delta
          } else {
            blocks.push({ id: nextBlockId(), type: 'thinking', content: assistantEvent.delta })
          }
          break
        }

        if (assistantEvent.type === 'thinking_end') {
          break
        }

        if (assistantEvent.type === 'text_delta') {
          const last = blocks[blocks.length - 1]
          if (last && last.type === 'text') {
            last.content = (last.content || '') + assistantEvent.delta
          } else {
            blocks.push({ id: nextBlockId(), type: 'text', content: assistantEvent.delta })
          }
        }
        break
      }
      case 'tool_execution_start':
        blocks.push({
          id: nextBlockId(),
          type: 'tool',
          toolCallId: ae.toolCallId,
          toolName: ae.toolName,
          args: ae.args,
          status: 'running',
        })
        break
      case 'tool_execution_end': {
        const block = blocks.find(b => b.type === 'tool' && b.toolCallId === ae.toolCallId)
        if (block) {
          block.status = ae.isError ? 'error' : 'completed'
          block.result = ae.result?.content?.map((c: any) => c.text || '').join('') || JSON.stringify(ae.result)
        }
        break
      }
      case 'message_end': {
        if (ae.message?.errorMessage || ae.message?.stopReason === 'error') {
          blocks.push({ id: nextBlockId(), type: 'text', content: `\n\n**Error:** ${ae.message.errorMessage || 'Unknown API error'}` })
        }
        break
      }
    }
  }

  abort(bufferId: string): void {
    const agent = this.agents.get(bufferId)
    if (agent) {
      agent.abort()
    }
  }

  subscribe(bufferId: string, listener: (event: AgentEvent) => void): () => void {
    if (!this.subscribers.has(bufferId)) {
      this.subscribers.set(bufferId, new Set())
    }
    const subs = this.subscribers.get(bufferId)!
    subs.add(listener)
    return () => {
      subs.delete(listener)
    }
  }
}

// Singleton instance — in moav2 we don't rely on window.__agentService for HMR survival.
// The entry point manages lifecycle.
export const agentService = new AgentService()
