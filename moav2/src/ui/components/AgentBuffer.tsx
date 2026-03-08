import { useEffect, useRef, useCallback, useMemo, useSyncExternalStore, memo } from 'react'
import Markdown from 'react-markdown'
import ToolBlock from './ToolBlock'
import { sessionStore } from '../../core/services/session-store'
import type { DisplayBlock } from '../../core/services/session-store'
import '../../styles/AgentBuffer.css'

interface AgentBufferProps {
  sessionId: string
  model: string
  onSessionUpdate?: () => void
  onStreamingChange?: (sessionId: string, streaming: boolean) => void
  onModelClick?: () => void
}

/** Determine CSS modifier class for system messages based on content */
function systemMessageClass(content: string): string {
  const lower = content.toLowerCase()
  if (lower.includes('error') || lower.includes('failed') || lower.includes('not ready') ||
      lower.includes('not found') || lower.includes('denied') || lower.includes('authentication') ||
      lower.includes('not configured') || lower.includes('no api key')) {
    return 'system-error'
  }
  if (lower.includes('retrying')) {
    return 'system-retry'
  }
  return ''
}

/** Memoized so completed message blocks don't re-render when only the
 *  latest streaming block changes. */
const BlockRenderer = memo(function BlockRenderer({
  blocks,
  expandedTools,
  onToggleTool,
  isStreaming,
}: {
  blocks: DisplayBlock[]
  expandedTools: Set<string>
  onToggleTool: (id: string) => void
  isStreaming: boolean
}) {
  return (
    <>
      {blocks.map((block) => {
        if (block.type === 'text' && block.content) {
          return <Markdown key={block.id}>{block.content}</Markdown>
        }
        if (block.type === 'tool') {
          return (
            <ToolBlock
              key={block.id}
              toolName={block.toolName || ''}
              args={block.args}
              status={block.status || 'running'}
              result={block.result}
              isExpanded={expandedTools.has(block.id)}
              onToggle={() => onToggleTool(block.id)}
            />
          )
        }
        if (block.type === 'thinking') {
          const expanded = expandedTools.has(block.id)
          return (
            <div key={block.id} className={`thinking-block ${expanded ? 'expanded' : ''}`}>
              <button type="button" className="thinking-block-header" onClick={() => onToggleTool(block.id)}>
                <span className={`thinking-block-chevron ${expanded ? 'expanded' : ''}`}>{'>'}</span>
                <span className={`thinking-block-label ${isStreaming ? 'streaming' : ''}`}>
                  {isStreaming ? 'Thinking...' : 'Thinking'}
                </span>
              </button>
              <div className={`thinking-block-body ${expanded ? 'expanded' : ''}`}>
                <pre className="thinking-block-content">{block.content || ''}</pre>
              </div>
            </div>
          )
        }
        return null
      })}
    </>
  )
})

export default function AgentBuffer({ sessionId, model, onSessionUpdate, onStreamingChange, onModelClick }: AgentBufferProps) {
  // Subscribe to the global session store which survives HMR
  const state = useSyncExternalStore(
    sessionStore.subscribe,
    () => sessionStore.getSession(sessionId)
  )

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const prevMsgCountRef = useRef(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Initialize session (load DB, create agent)
  useEffect(() => {
    sessionStore.initSession(sessionId, model)
  }, [sessionId, model])

  // Scroll to bottom when content changes.
  // Use 'instant' during active streaming to avoid smooth-scroll overhead
  // (smooth scrollIntoView fires layout recalcs on every streaming update).
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: state.isStreaming ? 'instant' : 'smooth'
    })
  }, [state.messages.length, state.streamingBlocks.length, state.isStreaming])

  // Notify parent when streaming state changes
  useEffect(() => {
    onStreamingChange?.(sessionId, state.isStreaming)
  }, [sessionId, state.isStreaming, onStreamingChange])

  // Notify parent to refresh session list (e.g. when title changes on first message)
  useEffect(() => {
    if (prevMsgCountRef.current === 0 && state.messages.length > 0) {
      onSessionUpdate?.()
    }
    prevMsgCountRef.current = state.messages.length
  }, [state.messages.length, onSessionUpdate])

  // Auto-focus textarea on mount and session switch
  useEffect(() => {
    textareaRef.current?.focus()
  }, [sessionId])

  // Auto-expand textarea — caps at ~6 lines (168px)
  const autoResize = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const maxH = 168
    ta.style.height = Math.min(ta.scrollHeight, maxH) + 'px'
  }, [])

  useEffect(() => {
    autoResize()
  }, [state.input, autoResize])

  const hasContent = state.messages.length > 0 || state.streamingBlocks.length > 0
  const isWaitingForResponse = state.isWaitingForResponse && state.streamingBlocks.length === 0

  // Memoize the "now" date string for streaming blocks so we don't call
  // new Date().toLocaleDateString() on every streaming render (~dozens/sec).
  // Only recomputes when streaming state changes (start/stop).
  const streamingTimestamp = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }, [state.isStreaming])

  const handleSendMessage = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
    sessionStore.sendMessage(sessionId)
    messagesEndRef.current?.scrollIntoView({ behavior: 'instant' })
    // Reset textarea height after send
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // Display-friendly model name
  const modelDisplay = model
    ? model.replace(/^(anthropic-key:|anthropic-oauth:|openai-oauth:|openai:|vertex-express:|vertex:)/, '').replace(/-20\d{6}.*/, '')
    : 'no model'

  return (
    <div className="agent-buffer">
      <div className="messages-container">
        {!hasContent ? (
          <div className="empty-chat">
            {state.isLoading ? (
              <p>Loading history...</p>
            ) : (
              <>
                {!model ? (
                  <div className="no-model-prompt">
                    <h2 className="hero-heading">Configure a provider to start chatting</h2>
                    <button className="no-model-btn" onClick={onModelClick}>Open settings</button>
                  </div>
                ) : (
                  <h2 className="hero-heading">What will you conquer?</h2>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            {state.messages.map((msg) => (
              <div key={msg.id} className={`message-group ${msg.role}`}>
                {msg.role !== 'system' && (
                  <div className="message-timestamp">
                    {new Date(msg.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                )}
                <div className={`message ${msg.role}`}>
                  <div className="message-content">
                    {msg.role === 'assistant' ? (
                      <BlockRenderer
                        blocks={msg.blocks}
                        expandedTools={state.expandedTools}
                        onToggleTool={(id) => sessionStore.toggleTool(sessionId, id)}
                        isStreaming={false}
                      />
                    ) : msg.role === 'system' ? (
                      <div className={`system-message ${systemMessageClass(msg.blocks[0]?.content || '')}`}>
                        {msg.blocks[0]?.content || ''}
                      </div>
                    ) : (
                      <p>{msg.blocks[0]?.content || ''}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {state.streamingBlocks.length > 0 && (
              <div className="message-group assistant">
                <div className="message-timestamp">
                  {streamingTimestamp}
                </div>
                <div className="message assistant streaming">
                  <div className="message-content">
                    <BlockRenderer
                      blocks={state.streamingBlocks}
                      expandedTools={state.expandedTools}
                      onToggleTool={(id) => sessionStore.toggleTool(sessionId, id)}
                      isStreaming={state.isStreaming}
                    />
                  </div>
                </div>
              </div>
            )}
            {isWaitingForResponse && (
              <div className="message-group assistant">
                <div className="message-timestamp">
                  {streamingTimestamp}
                </div>
                <div className="message assistant streaming waiting">
                  <div className="message-content">
                    <div className="assistant-loading" aria-label="Assistant is thinking">
                      <span className="loading-dots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {state.sendError && (
        <div className="send-error-banner">
          <span className="send-error-text">{state.sendError}</span>
          <button
            className="send-error-dismiss"
            onClick={() => sessionStore.clearSendError(sessionId)}
            title="Dismiss"
          >
            x
          </button>
        </div>
      )}

      <div className="input-area">
        <div className="input-pill">
          <button
            className="model-badge"
            onClick={onModelClick}
            title="Change model"
          >
            {modelDisplay}
          </button>
          <textarea
            ref={textareaRef}
            value={state.input}
            onChange={(e) => sessionStore.setInput(sessionId, e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            disabled={!state.agentReady}
            rows={1}
          />
          <button
            onClick={handleSendMessage}
            disabled={!state.input.trim() || !state.agentReady}
            className="send-btn"
          >
            {state.isStreaming ? '\u21AA' : '\u2191'}
          </button>
        </div>
      </div>
    </div>
  )
}
