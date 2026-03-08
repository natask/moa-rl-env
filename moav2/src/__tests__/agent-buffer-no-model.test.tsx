import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const mockState = {
  messages: [],
  streamingBlocks: [],
  input: '',
  isStreaming: false,
  expandedTools: new Set<string>(),
  agentReady: false,
  isLoading: false,
  model: '',
  sendError: null,
}

vi.mock('../core/services/session-store', () => ({
  sessionStore: {
    subscribe: () => () => {},
    getSession: () => mockState,
    initSession: vi.fn(),
    sendMessage: vi.fn(),
    setInput: vi.fn(),
    toggleTool: vi.fn(),
    clearSendError: vi.fn(),
  },
}))

import AgentBuffer from '../ui/components/AgentBuffer'

describe('AgentBuffer model-less session UX', () => {
  it('shows configure provider prompt when model is empty', () => {
    const onModelClick = vi.fn()
    render(<AgentBuffer sessionId="s1" model="" onModelClick={onModelClick} />)

    expect(screen.getByText(/configure a provider/i)).toBeTruthy()
    const button = screen.getByRole('button', { name: /open settings/i })
    fireEvent.click(button)
    expect(onModelClick).toHaveBeenCalled()
  })
})
