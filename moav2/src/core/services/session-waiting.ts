import type { AgentEvent } from '@mariozechner/pi-agent-core'

export function hasAssistantResponseStarted(agentEvent: AgentEvent): boolean {
  if (agentEvent.type === 'tool_execution_start' || agentEvent.type === 'message_end') {
    return true
  }

  if (agentEvent.type !== 'message_update') {
    return false
  }

  const assistantEvent = (agentEvent as any).assistantMessageEvent
  return !!assistantEvent
}
