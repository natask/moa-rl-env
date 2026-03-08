import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import AgentBuffer from '../ui/components/AgentBuffer'

let mockState: any
const listeners = new Set<() => void>()

vi.mock('../core/services/session-store', () => ({
  sessionStore: {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSession: () => mockState,
    initSession: vi.fn(),
    toggleTool: vi.fn(),
    setInput: vi.fn(),
    sendMessage: vi.fn(),
    clearSendError: vi.fn(),
  },
}))

describe('AgentBuffer UI states', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    ;(Element.prototype as any).scrollIntoView = vi.fn()
    listeners.clear()
    mockState = {
      messages: [],
      streamingBlocks: [],
      expandedTools: new Set<string>(),
      input: '',
      isLoading: false,
      isStreaming: false,
      isWaitingForResponse: false,
      agentReady: true,
      sendError: '',
    }
  })

  it('shows only the dot indicator while waiting for response', () => {
    mockState.isWaitingForResponse = true
    mockState.messages = [
      {
        id: 'u1',
        role: 'user',
        blocks: [{ id: 'ub1', type: 'text', content: 'hello' }],
        createdAt: Date.now(),
      },
    ]

    render(<AgentBuffer sessionId="s1" model="anthropic-oauth:claude-3-7-sonnet" />)

    expect(screen.getByLabelText('Assistant is thinking')).toBeTruthy()
    expect(screen.queryByText('Waiting for response')).toBeNull()
  })

  it('shows streaming thinking block instead of waiting indicator once assistant starts', () => {
    mockState.isWaitingForResponse = true
    mockState.isStreaming = true
    mockState.streamingBlocks = [
      { id: 't1', type: 'thinking', content: 'Analyzing request...' },
    ]

    render(<AgentBuffer sessionId="s1" model="anthropic-oauth:claude-3-7-sonnet" />)

    expect(screen.queryByLabelText('Assistant is thinking')).toBeNull()
    expect(screen.getByText('Thinking...')).toBeTruthy()
  })
})
