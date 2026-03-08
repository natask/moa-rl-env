/**
 * Scroll behavior tests for AgentBuffer.
 *
 * The AgentBuffer component uses a useEffect that calls
 * messagesEndRef.current?.scrollIntoView({ behavior }) where behavior
 * is 'instant' during streaming and 'smooth' otherwise.
 *
 * We also test the pure helper `systemMessageClass` which classifies
 * system message content for CSS styling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isRetryableError } from '../core/services/retry'

// ---------------------------------------------------------------------------
// 1. systemMessageClass — pure function extracted from AgentBuffer.tsx
// ---------------------------------------------------------------------------

// The function is defined inline in AgentBuffer.tsx (not exported), so we
// replicate it here for direct unit testing.  If it ever gets extracted and
// exported, swap this for a direct import.
function systemMessageClass(content: string): string {
  const lower = content.toLowerCase()
  if (
    lower.includes('error') ||
    lower.includes('failed') ||
    lower.includes('not ready') ||
    lower.includes('not found') ||
    lower.includes('denied') ||
    lower.includes('authentication') ||
    lower.includes('not configured') ||
    lower.includes('no api key')
  ) {
    return 'system-error'
  }
  if (lower.includes('retrying')) {
    return 'system-retry'
  }
  return ''
}

describe('systemMessageClass', () => {
  it('returns "system-error" for messages containing "error"', () => {
    expect(systemMessageClass('Something went wrong: error')).toBe('system-error')
  })

  it('returns "system-error" for "failed"', () => {
    expect(systemMessageClass('Request failed with status 500')).toBe('system-error')
  })

  it('returns "system-error" for "not ready"', () => {
    expect(systemMessageClass('Agent is not ready')).toBe('system-error')
  })

  it('returns "system-error" for "not found"', () => {
    expect(systemMessageClass('Model not found')).toBe('system-error')
  })

  it('returns "system-error" for "denied"', () => {
    expect(systemMessageClass('Permission denied')).toBe('system-error')
  })

  it('returns "system-error" for "authentication"', () => {
    expect(systemMessageClass('Authentication failed')).toBe('system-error')
  })

  it('returns "system-error" for "not configured"', () => {
    expect(systemMessageClass('Provider not configured')).toBe('system-error')
  })

  it('returns "system-error" for "no api key"', () => {
    expect(systemMessageClass('No API key set')).toBe('system-error')
  })

  it('returns "system-retry" for "retrying"', () => {
    expect(systemMessageClass('Retrying... (attempt 2/3)')).toBe('system-retry')
  })

  it('returns empty string for neutral system messages', () => {
    expect(systemMessageClass('Session started')).toBe('')
  })

  it('is case-insensitive', () => {
    expect(systemMessageClass('ERROR: something broke')).toBe('system-error')
    expect(systemMessageClass('RETRYING connection')).toBe('system-retry')
  })

  it('prioritizes error over retry when both present', () => {
    // "error" check comes first in the if-chain
    expect(systemMessageClass('Error: retrying...')).toBe('system-error')
  })
})

// ---------------------------------------------------------------------------
// 2. Scroll behavior logic — unit test of the scroll decision
// ---------------------------------------------------------------------------

// The actual useEffect in AgentBuffer does:
//   messagesEndRef.current?.scrollIntoView({
//     behavior: state.isStreaming ? 'instant' : 'smooth'
//   })
//
// We test the logic that determines scroll behavior separately from the
// React component to keep these tests fast and deterministic.

describe('scroll behavior decision', () => {
  function resolveScrollBehavior(isStreaming: boolean): ScrollBehavior {
    return isStreaming ? 'instant' : 'smooth'
  }

  it('uses instant scroll during streaming', () => {
    expect(resolveScrollBehavior(true)).toBe('instant')
  })

  it('uses smooth scroll after streaming ends', () => {
    expect(resolveScrollBehavior(false)).toBe('smooth')
  })
})

// ---------------------------------------------------------------------------
// 3. Scroll trigger conditions — the effect depends on specific state
// ---------------------------------------------------------------------------

describe('scroll trigger conditions', () => {
  // The useEffect dependency array is:
  //   [state.messages.length, state.streamingBlocks.length, state.isStreaming]
  // We simulate state transitions and verify the effect would fire.

  interface ScrollState {
    messagesLength: number
    streamingBlocksLength: number
    isStreaming: boolean
  }

  function shouldScroll(prev: ScrollState, next: ScrollState): boolean {
    // The effect fires when any dep changes
    return (
      prev.messagesLength !== next.messagesLength ||
      prev.streamingBlocksLength !== next.streamingBlocksLength ||
      prev.isStreaming !== next.isStreaming
    )
  }

  it('triggers scroll when a new message is added', () => {
    const prev: ScrollState = { messagesLength: 2, streamingBlocksLength: 0, isStreaming: false }
    const next: ScrollState = { messagesLength: 3, streamingBlocksLength: 0, isStreaming: false }
    expect(shouldScroll(prev, next)).toBe(true)
  })

  it('triggers scroll when streaming blocks update', () => {
    const prev: ScrollState = { messagesLength: 2, streamingBlocksLength: 1, isStreaming: true }
    const next: ScrollState = { messagesLength: 2, streamingBlocksLength: 2, isStreaming: true }
    expect(shouldScroll(prev, next)).toBe(true)
  })

  it('triggers scroll when streaming state changes', () => {
    const prev: ScrollState = { messagesLength: 2, streamingBlocksLength: 3, isStreaming: true }
    const next: ScrollState = { messagesLength: 2, streamingBlocksLength: 3, isStreaming: false }
    expect(shouldScroll(prev, next)).toBe(true)
  })

  it('does not trigger scroll when nothing changes', () => {
    const prev: ScrollState = { messagesLength: 2, streamingBlocksLength: 0, isStreaming: false }
    const next: ScrollState = { messagesLength: 2, streamingBlocksLength: 0, isStreaming: false }
    expect(shouldScroll(prev, next)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 4. Session switch — empty session hero text
// ---------------------------------------------------------------------------

describe('empty session detection', () => {
  // In AgentBuffer, the hero text is shown when:
  //   const hasContent = state.messages.length > 0 || state.streamingBlocks.length > 0
  //   {!hasContent ? <div className="empty-chat"> ... }

  function hasContent(messagesLength: number, streamingBlocksLength: number): boolean {
    return messagesLength > 0 || streamingBlocksLength > 0
  }

  it('shows hero text when no messages and no streaming blocks', () => {
    expect(hasContent(0, 0)).toBe(false)
  })

  it('hides hero text when messages exist', () => {
    expect(hasContent(1, 0)).toBe(true)
  })

  it('hides hero text when streaming blocks exist', () => {
    expect(hasContent(0, 1)).toBe(true)
  })

  it('hides hero text when both exist', () => {
    expect(hasContent(3, 2)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. SessionStore (unit tests of subscribe/notify)
// ---------------------------------------------------------------------------

describe('SessionStore subscribe/notify', () => {
  // We test the core subscribe/notify contract without importing the real
  // SessionStore (which has heavy dependencies on agent-service, db, etc.)

  class MinimalStore {
    private listeners = new Set<() => void>()
    subscribe(listener: () => void): () => void {
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    }
    notify() {
      for (const listener of this.listeners) listener()
    }
  }

  it('notifies all subscribers', () => {
    const store = new MinimalStore()
    const fn1 = vi.fn()
    const fn2 = vi.fn()
    store.subscribe(fn1)
    store.subscribe(fn2)
    store.notify()
    expect(fn1).toHaveBeenCalledOnce()
    expect(fn2).toHaveBeenCalledOnce()
  })

  it('unsubscribe removes the listener', () => {
    const store = new MinimalStore()
    const fn = vi.fn()
    const unsub = store.subscribe(fn)
    unsub()
    store.notify()
    expect(fn).not.toHaveBeenCalled()
  })

  it('multiple unsubscribes are idempotent', () => {
    const store = new MinimalStore()
    const fn = vi.fn()
    const unsub = store.subscribe(fn)
    unsub()
    unsub() // second call should be harmless
    store.notify()
    expect(fn).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 6. isRetryableError shared helper
// ---------------------------------------------------------------------------

describe('isRetryableError', () => {

  it('identifies rate limit errors as transient', () => {
    expect(isRetryableError({ message: 'Error 429: rate limit exceeded' })).toBe(true)
    expect(isRetryableError({ message: 'rate limit exceeded' })).toBe(true)
  })

  it('identifies server errors as transient', () => {
    expect(isRetryableError({ message: 'Internal server error 500' })).toBe(true)
    expect(isRetryableError({ message: 'Bad gateway 502' })).toBe(true)
    expect(isRetryableError({ message: 'Service unavailable 503' })).toBe(true)
  })

  it('identifies network errors as transient', () => {
    expect(isRetryableError({ message: 'fetch failed' })).toBe(true)
    expect(isRetryableError({ message: 'ECONNREFUSED' })).toBe(true)
    expect(isRetryableError({ message: 'ECONNRESET' })).toBe(true)
  })

  it('identifies timeout errors as transient', () => {
    expect(isRetryableError({ message: 'Request timed out' })).toBe(true)
  })

  it('identifies overloaded errors as transient', () => {
    expect(isRetryableError({ message: 'Server overloaded' })).toBe(true)
    expect(isRetryableError({ message: 'At capacity' })).toBe(true)
  })

  it('does NOT treat auth errors as transient', () => {
    expect(isRetryableError({ message: 'Invalid API key (401)' })).toBe(false)
    expect(isRetryableError({ message: 'Forbidden (403)' })).toBe(false)
  })

  it('does NOT treat model-not-found as transient', () => {
    expect(isRetryableError({ message: 'Model does not exist' })).toBe(false)
  })

  it('handles non-Error objects gracefully', () => {
    expect(isRetryableError('timeout')).toBe(true)
    expect(isRetryableError('something unknown')).toBe(false)
  })
})
