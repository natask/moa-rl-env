import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@mariozechner/pi-agent-core'
import { hasAssistantResponseStarted } from '../core/services/session-waiting'

describe('session store waiting state', () => {
  it('clears waiting as soon as assistant emits message_update', () => {
    const event = {
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_start' },
    } as unknown as AgentEvent

    expect(hasAssistantResponseStarted(event)).toBe(true)
  })

  it('clears waiting when tool execution starts before text', () => {
    const event = { type: 'tool_execution_start' } as unknown as AgentEvent
    expect(hasAssistantResponseStarted(event)).toBe(true)
  })

  it('does not clear waiting for unrelated events', () => {
    const event = { type: 'message_start' } as unknown as AgentEvent
    expect(hasAssistantResponseStarted(event)).toBe(false)
  })
})
