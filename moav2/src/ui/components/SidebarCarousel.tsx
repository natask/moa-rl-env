import { useRef, useCallback } from 'react'
import '../../styles/SidebarCarousel.css'

export interface CarouselTab {
  id: string
  title: string
  pinned: boolean
  sortOrder: number
  /** Only for agent tabs */
  isStreaming?: boolean
  /** Only for browser tabs */
  url?: string
}

type PanelType = 'agent' | 'terminal' | 'browser'

interface SidebarCarouselProps {
  panelType: PanelType
  tabs: CarouselTab[]
  activeTabId: string | null
  onSelect: (id: string) => void
  onPin: (id: string) => void
  onUnpin: (id: string) => void
  onDelete: (id: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onCreate: () => void
}

export default function SidebarCarousel({
  panelType,
  tabs,
  activeTabId,
  onSelect,
  onPin,
  onUnpin,
  onDelete,
  onReorder,
  onCreate,
}: SidebarCarouselProps) {
  const dragIndexRef = useRef<number | null>(null)
  const dropIndexRef = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    dragIndexRef.current = index
    e.dataTransfer.effectAllowed = 'move'
    // Make the drag image slightly transparent
    const el = e.currentTarget as HTMLElement
    el.classList.add('dragging')
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    dropIndexRef.current = index

    // Show drop indicator
    const items = listRef.current?.querySelectorAll('.carousel-tab')
    items?.forEach((item, i) => {
      item.classList.toggle('drop-above', i === index && dragIndexRef.current !== null && dragIndexRef.current > index)
      item.classList.toggle('drop-below', i === index && dragIndexRef.current !== null && dragIndexRef.current < index)
    })
  }, [])

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove('dragging')
    // Clear all drop indicators
    listRef.current?.querySelectorAll('.carousel-tab').forEach(item => {
      item.classList.remove('drop-above', 'drop-below')
    })

    if (dragIndexRef.current !== null && dropIndexRef.current !== null && dragIndexRef.current !== dropIndexRef.current) {
      onReorder(dragIndexRef.current, dropIndexRef.current)
    }
    dragIndexRef.current = null
    dropIndexRef.current = null
  }, [onReorder])

  const panelLabel = panelType === 'agent' ? 'chat' : panelType

  return (
    <div className="sidebar-carousel">
      <div className="carousel-tabs" ref={listRef}>
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            className={`carousel-tab ${activeTabId === tab.id ? 'active' : ''} ${tab.pinned ? 'pinned' : ''} ${tab.isStreaming ? 'streaming' : ''}`}
            onClick={() => onSelect(tab.id)}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
          >
            <span className="carousel-tab-title">
              {tab.isStreaming && <span className="streaming-dot" />}
              {tab.title || (panelType === 'agent' ? 'New Chat' : panelType === 'terminal' ? 'New Thread' : 'Browser')}
            </span>

            <span className="carousel-tab-actions">
              {/* Pin/unpin button — visible on hover or when pinned */}
              <button
                className={`carousel-pin-btn ${tab.pinned ? 'pinned' : ''}`}
                onClick={(e) => { e.stopPropagation(); tab.pinned ? onUnpin(tab.id) : onPin(tab.id) }}
                title={tab.pinned ? 'Unpin' : 'Pin'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: tab.pinned ? 'none' : 'rotate(45deg)', transition: 'transform 0.2s ease' }}>
                  <path d="M12 17v5" />
                  <path d="M9 2h6l-1 7h4l-2 4H8l-2-4h4L9 2z" />
                </svg>
              </button>

              {/* Close button — only on unpinned tabs */}
              {!tab.pinned && (
                <button
                  className="carousel-close-btn"
                  onClick={(e) => { e.stopPropagation(); onDelete(tab.id) }}
                  title={`Close ${panelLabel}`}
                >
                  &times;
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      <button className="carousel-new-btn" onClick={onCreate}>
        + New {panelLabel}
      </button>
    </div>
  )
}
