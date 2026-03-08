import { useEffect, useId, useMemo, useRef, useState } from 'react'
import '../../styles/Dropdown.css'

export interface DropdownOption {
  value: string
  label: string
}

interface DropdownProps {
  options: DropdownOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export default function Dropdown({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  className,
}: DropdownProps) {
  const OPTION_ROW_HEIGHT = 34
  const MIN_VISIBLE_OPTIONS = 3
  const VIEWPORT_MARGIN = 10
  const VERTICAL_OFFSET = 4

  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: OPTION_ROW_HEIGHT * 6,
    minHeight: OPTION_ROW_HEIGHT,
  })
  const listboxId = useId()

  const selectedIndex = useMemo(
    () => Math.max(0, options.findIndex((o) => o.value === value)),
    [options, value]
  )
  const selected = options.find((o) => o.value === value)
  const highlightedOption = options[highlightedIndex]

  const syncPosition = () => {
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const availableBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN
    const minVisibleHeight = Math.min(options.length, MIN_VISIBLE_OPTIONS) * OPTION_ROW_HEIGHT
    const maxHeight = Math.max(minVisibleHeight, availableBelow)

    setPosition({
      left: rect.left,
      top: rect.bottom + VERTICAL_OFFSET,
      width: rect.width,
      maxHeight,
      minHeight: minVisibleHeight,
    })
  }

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return

    setHighlightedIndex(selectedIndex)
    syncPosition()

    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current
      if (!root) return

      if (!root.contains(event.target as Node)) {
        close()
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open, selectedIndex])

  useEffect(() => {
    if (!open) return
    const active = document.getElementById(`${listboxId}-${highlightedIndex}`)
    if (active && typeof (active as any).scrollIntoView === 'function') {
      ;(active as any).scrollIntoView({ block: 'nearest' })
    }
  }, [open, highlightedIndex, listboxId])

  const move = (delta: number) => {
    if (options.length === 0) return
    setHighlightedIndex((prev) => {
      const next = (prev + delta + options.length) % options.length
      return next
    })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const ctrlN = e.ctrlKey && e.key.toLowerCase() === 'n'
    const ctrlP = e.ctrlKey && e.key.toLowerCase() === 'p'

    if (e.key === 'ArrowDown' || ctrlN) {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      move(1)
      return
    }
    if (e.key === 'ArrowUp' || ctrlP) {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      move(-1)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
      } else if (highlightedOption) {
        onChange(highlightedOption.value)
        close()
      }
      return
    }
    if (e.key === ' ') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
      } else if (highlightedOption) {
        onChange(highlightedOption.value)
        close()
      }
      return
    }
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      close()
    }
  }

  return (
    <div ref={rootRef} className={`dropdown-root${className ? ` ${className}` : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`dropdown-trigger${className ? ` ${className}` : ''}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? `${listboxId}-${highlightedIndex}` : undefined}
        aria-autocomplete="none"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? 'dropdown-value' : 'dropdown-placeholder'}>{selected?.label || placeholder}</span>
        <span className="dropdown-chevron" aria-hidden="true">⌄</span>
      </button>

      {open && (
        <div
          id={listboxId}
          ref={listRef}
          role="listbox"
          className="dropdown-list"
          style={{
            left: `${position.left}px`,
            top: `${position.top}px`,
            width: `${position.width}px`,
            maxHeight: `${position.maxHeight}px`,
            minHeight: `${position.minHeight}px`,
          }}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value
            const isHighlighted = index === highlightedIndex
            return (
              <button
                id={`${listboxId}-${index}`}
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`dropdown-option${isHighlighted ? ' highlighted' : ''}${isSelected ? ' selected' : ''}`}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => {
                  onChange(option.value)
                  close()
                }}
              >
                <span>{option.label}</span>
                {isSelected && <span className="dropdown-check">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
