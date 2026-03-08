import { memo } from 'react'
import '../../styles/AgentBuffer.css'

interface ToolBlockProps {
  toolName: string
  args?: Record<string, any>
  status: 'running' | 'completed' | 'error'
  result?: string
  isExpanded: boolean
  onToggle: () => void
}

function getToolParam(toolName: string, args?: Record<string, any>): string {
  if (!args) return ''
  switch (toolName) {
    case 'read':
    case 'write':
    case 'edit': {
      const p = args.path || ''
      // Show just filename + parent dir
      const parts = p.split('/')
      return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : p
    }
    case 'bash': {
      const cmd = args.command || ''
      return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd
    }
    default:
      return JSON.stringify(args).slice(0, 60)
  }
}

function StatusIcon({ status }: { status: 'running' | 'completed' | 'error' }) {
  if (status === 'running') {
    return <span className="tool-block-status running">···</span>
  }
  if (status === 'error') {
    return <span className="tool-block-status error">✕</span>
  }
  return <span className="tool-block-status completed">✓</span>
}

/** Memoized to prevent re-rendering completed tool blocks when only the
 *  latest streaming block changes. */
const ToolBlock = memo(function ToolBlock({ toolName, args, status, result, isExpanded, onToggle }: ToolBlockProps) {
  const param = getToolParam(toolName, args)

  return (
    <div className={`tool-block ${status}`}>
      <button className="tool-block-header" onClick={onToggle} type="button">
        <span className={`tool-block-chevron ${isExpanded ? 'expanded' : ''}`}>▸</span>
        <span className="tool-block-name">{toolName}</span>
        {param && <span className="tool-block-param">{param}</span>}
        <StatusIcon status={status} />
      </button>
      {isExpanded && result && (
        <div className="tool-block-body">
          <pre><code>{result}</code></pre>
        </div>
      )}
    </div>
  )
})

export default ToolBlock
