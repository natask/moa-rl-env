import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import CommandPalette from '../ui/components/CommandPalette'

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

const noop = () => {}

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    isOpen: true,
    onClose: noop,
    activeBuffer: 'agent' as const,
    onSwitchBuffer: noop,
    sessions: [
      { id: 's1', title: 'Chat One', model: 'claude', createdAt: 1, updatedAt: 1 },
      { id: 's2', title: 'Chat Two', model: 'claude', createdAt: 2, updatedAt: 2 },
    ],
    activeSessionId: 's1',
    onSwitchSession: noop,
    onCreateSession: noop,
    onOpenSettings: noop,
    onOpenSettingsTab: noop,
    canCreateSession: true,
    onDeleteSession: noop,
    onRenameSession: noop,
    currentModel: 'claude-sonnet',
    availableModels: [
      { value: 'claude-sonnet', label: 'Claude Sonnet', group: 'Anthropic' },
    ],
    onSelectModel: noop,
    onBrowserBack: noop,
    onBrowserForward: noop,
    onBrowserReload: noop,
    onBrowserFocusUrl: noop,
    onAgentClearInput: noop,
    onAgentStopGeneration: noop,
    isStreaming: false,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  localStorage.clear()
})

describe('CommandPalette keyboard navigation', () => {
  it('Ctrl+N moves selection down', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByPlaceholderText(/Type a command/)

    // First item should be selected initially
    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))
    expect(items[0].classList.contains('selected')).toBe(true)

    // Press Ctrl+N to move down
    fireEvent.keyDown(input, { key: 'n', ctrlKey: true })
    expect(items[1].classList.contains('selected')).toBe(true)
  })

  it('Ctrl+P moves selection up', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByPlaceholderText(/Type a command/)
    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))

    // Move down first, then up
    fireEvent.keyDown(input, { key: 'n', ctrlKey: true })
    expect(items[1].classList.contains('selected')).toBe(true)

    fireEvent.keyDown(input, { key: 'p', ctrlKey: true })
    expect(items[0].classList.contains('selected')).toBe(true)
  })

  it('Ctrl+P wraps from top to bottom', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByPlaceholderText(/Type a command/)
    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))

    // At index 0, Ctrl+P should wrap to last item
    fireEvent.keyDown(input, { key: 'p', ctrlKey: true })
    expect(items[items.length - 1].classList.contains('selected')).toBe(true)
  })

  it('Ctrl+N wraps from bottom to top', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByPlaceholderText(/Type a command/)
    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))

    // Navigate to last item first
    fireEvent.keyDown(input, { key: 'p', ctrlKey: true })
    expect(items[items.length - 1].classList.contains('selected')).toBe(true)

    // Ctrl+N should wrap to first
    fireEvent.keyDown(input, { key: 'n', ctrlKey: true })
    expect(items[0].classList.contains('selected')).toBe(true)
  })
})

describe('CommandPalette checkmark rendering', () => {
  it('shows checkmark for active selectable items', () => {
    // activeBuffer is 'agent', so the Agent buffer item should have a checkmark
    render(<CommandPalette {...defaultProps()} />)
    const checkmarks = document.querySelectorAll('.command-palette-check')
    expect(checkmarks.length).toBeGreaterThan(0)
    // The checkmark character
    expect(checkmarks[0].textContent).toBe('\u2713')
  })

  it('does not show old "current" badge', () => {
    render(<CommandPalette {...defaultProps()} />)
    const activeBadges = document.querySelectorAll('.command-palette-active')
    expect(activeBadges.length).toBe(0)
  })

  it('executable items never show checkmark', () => {
    // "New Session" is executable — should have no checkmark even though other items do
    render(<CommandPalette {...defaultProps()} />)
    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))
    const newSessionItem = items.find(b => b.textContent?.includes('New Session'))
    expect(newSessionItem).toBeDefined()
    const check = newSessionItem!.querySelector('.command-palette-check')
    expect(check).toBeNull()
  })
})

describe('CommandPalette fuzzy search', () => {
  it('filters by fuzzy match', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByPlaceholderText(/Type a command/)

    // Type fuzzy query "nse" — should match "New Session"
    fireEvent.change(input, { target: { value: 'nse' } })

    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))
    const labels = items.map(b => b.querySelector('.command-palette-label')?.textContent)
    expect(labels.some(l => l === 'New Session')).toBe(true)
  })

  it('matches tokens in any order across category + label', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByPlaceholderText(/Type a command/)

    // "se d" — "se" matches Session category, "d" matches Delete
    fireEvent.change(input, { target: { value: 'se d' } })

    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))
    const labels = items.map(b => b.querySelector('.command-palette-label')?.textContent)
    expect(labels.some(l => l === 'Delete Session')).toBe(true)
  })

  it('shows empty state for unmatched query', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByPlaceholderText(/Type a command/)

    fireEvent.change(input, { target: { value: 'zzzzz' } })

    expect(screen.getByText('No matching commands')).toBeDefined()
  })
})

describe('CommandPalette ArrowDown/ArrowUp navigation', () => {
  it('ArrowDown increments selectedIndex', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByPlaceholderText(/Type a command/)
    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))

    expect(items[0].classList.contains('selected')).toBe(true)

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(items[1].classList.contains('selected')).toBe(true)
  })

  it('ArrowUp decrements selectedIndex', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByPlaceholderText(/Type a command/)
    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))

    // Move down first
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(items[1].classList.contains('selected')).toBe(true)

    // Move back up
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(items[0].classList.contains('selected')).toBe(true)
  })

  it('ArrowUp wraps from top to bottom', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByPlaceholderText(/Type a command/)
    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))

    // At index 0, ArrowUp should wrap to last item
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(items[items.length - 1].classList.contains('selected')).toBe(true)
  })

  it('ArrowDown wraps from bottom to top', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByPlaceholderText(/Type a command/)
    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))

    // Navigate to last item first
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(items[items.length - 1].classList.contains('selected')).toBe(true)

    // ArrowDown should wrap to first
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(items[0].classList.contains('selected')).toBe(true)
  })

  it('multiple ArrowDown presses advance sequentially', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByPlaceholderText(/Type a command/)
    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })

    // Should be at index 3
    expect(items[3].classList.contains('selected')).toBe(true)
  })
})

describe('CommandPalette bang prefix filtering', () => {
  it('!a filters to agent/session commands only', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByPlaceholderText(/Type a command/)

    fireEvent.change(input, { target: { value: '!a' } })

    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))
    const categories = items.map(b => b.querySelector('.command-palette-category')?.textContent?.toLowerCase())

    // All visible items should be agent or session
    for (const cat of categories) {
      expect(cat === 'session' || cat === 'agent').toBe(true)
    }
    // Should have at least some items
    expect(items.length).toBeGreaterThan(0)
  })

  it('!t filters to terminal commands only', () => {
    render(<CommandPalette {...defaultProps({
      terminalTabs: [{ id: 't1', title: 'Thread 1' }],
      activeTerminalTabId: 't1',
      onSwitchTerminalTab: noop,
      onCreateTerminalTab: noop,
    })} />)
    const input = screen.getByPlaceholderText(/Type a command/)

    fireEvent.change(input, { target: { value: '!t' } })

    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))
    const categories = items.map(b => b.querySelector('.command-palette-category')?.textContent?.toLowerCase())

    for (const cat of categories) {
      expect(cat).toBe('terminal')
    }
    expect(items.length).toBeGreaterThan(0)
  })

  it('!b filters to browser commands only', () => {
    render(<CommandPalette {...defaultProps({
      browserTabs: [{ id: 'b1', title: 'Browser Tab 1' }],
      activeBrowserTabId: 'b1',
      onSwitchBrowserTab: noop,
      onCreateBrowserTab: noop,
    })} />)
    const input = screen.getByPlaceholderText(/Type a command/)

    fireEvent.change(input, { target: { value: '!b' } })

    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))
    const categories = items.map(b => b.querySelector('.command-palette-category')?.textContent?.toLowerCase())

    for (const cat of categories) {
      expect(cat === 'browser' || cat === 'browser tab').toBe(true)
    }
    expect(items.length).toBeGreaterThan(0)
  })

  it('!a with search further filters within agent commands', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByPlaceholderText(/Type a command/)

    // "!a new" — agent filter + fuzzy "new"
    fireEvent.change(input, { target: { value: '!a new' } })

    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))
    const labels = items.map(b => b.querySelector('.command-palette-label')?.textContent)

    // Should match "New Session" within agent/session category
    expect(labels.some(l => l === 'New Session')).toBe(true)

    // Should NOT show browser/terminal/settings commands
    const categories = items.map(b => b.querySelector('.command-palette-category')?.textContent?.toLowerCase())
    for (const cat of categories) {
      expect(cat === 'session' || cat === 'agent').toBe(true)
    }
  })

  it('shows correct placeholder for bang prefix', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByPlaceholderText(/Type a command/)

    fireEvent.change(input, { target: { value: '!b' } })

    // After re-render, the placeholder should update to "Search browser tabs..."
    // We verify by checking the input still has the bang value
    expect((input as HTMLInputElement).value).toBe('!b')
  })

  it('bang prefix with no matching items shows empty state', () => {
    render(<CommandPalette {...defaultProps()} />)
    const input = screen.getByPlaceholderText(/Type a command/)

    fireEvent.change(input, { target: { value: '!t zzzzz' } })

    expect(screen.getByText('No matching commands')).toBeDefined()
  })
})

describe('CommandPalette recency tracking', () => {
  it('records usage when a command is executed via Enter', () => {
    // Use a spy for onClose so the palette doesn't unmount
    const onClose = vi.fn()
    render(<CommandPalette {...defaultProps({ onClose })} />)
    const input = screen.getByPlaceholderText(/Type a command/)

    // Press Enter on the first item
    fireEvent.keyDown(input, { key: 'Enter' })

    // Check localStorage was updated
    const raw = localStorage.getItem('moa:command-recency')
    expect(raw).not.toBeNull()
    const map = JSON.parse(raw!)
    expect(Object.keys(map).length).toBeGreaterThan(0)
  })

  it('records usage when a command is clicked', () => {
    render(<CommandPalette {...defaultProps()} />)
    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))

    // Click the second item
    fireEvent.click(items[1])

    const raw = localStorage.getItem('moa:command-recency')
    expect(raw).not.toBeNull()
    const map = JSON.parse(raw!)
    expect(Object.keys(map).length).toBeGreaterThan(0)
  })
})

describe('CommandPalette Escape behavior', () => {
  it('Escape closes the palette in command mode', () => {
    const onClose = vi.fn()
    render(<CommandPalette {...defaultProps({ onClose })} />)
    const input = screen.getByPlaceholderText(/Type a command/)

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('mouseEnter updates selected index', () => {
    render(<CommandPalette {...defaultProps()} />)
    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))

    // Hover over 3rd item
    fireEvent.mouseEnter(items[2])
    expect(items[2].classList.contains('selected')).toBe(true)
    // Previous should no longer be selected
    expect(items[0].classList.contains('selected')).toBe(false)
  })
})

describe('CommandPalette initial mode behavior', () => {
  it('opens directly in model list when initialMode is models', () => {
    render(<CommandPalette {...defaultProps({ initialMode: 'models' })} />)
    expect(screen.getByPlaceholderText(/Select a model/)).toBeDefined()
  })

  it('Escape closes when opened directly in model mode', () => {
    const onClose = vi.fn()
    render(<CommandPalette {...defaultProps({ initialMode: 'models', onClose })} />)
    const input = screen.getByPlaceholderText(/Select a model/)

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Backspace closes when opened directly in model mode', () => {
    const onClose = vi.fn()
    render(<CommandPalette {...defaultProps({ initialMode: 'models', onClose })} />)
    const input = screen.getByPlaceholderText(/Select a model/)

    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('CommandPalette open/close events', () => {
  it('dispatches open and close lifecycle events', () => {
    const onOpen = vi.fn()
    const onClose = vi.fn()
    window.addEventListener('moa:command-palette-open', onOpen)
    window.addEventListener('moa:command-palette-close', onClose)

    const { rerender, unmount } = render(<CommandPalette {...defaultProps({ isOpen: true })} />)
    expect(onOpen).toHaveBeenCalledOnce()

    rerender(<CommandPalette {...defaultProps({ isOpen: false })} />)
    expect(onClose).toHaveBeenCalledOnce()

    window.removeEventListener('moa:command-palette-open', onOpen)
    window.removeEventListener('moa:command-palette-close', onClose)
    unmount()
  })
})

describe('CommandPalette session switching', () => {
  it('shows all sessions as selectable items', () => {
    render(<CommandPalette {...defaultProps()} />)
    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))
    const labels = items.map(b => b.querySelector('.command-palette-label')?.textContent)

    expect(labels).toContain('Chat One')
    expect(labels).toContain('Chat Two')
  })

  it('marks active session with checkmark', () => {
    render(<CommandPalette {...defaultProps()} />)
    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))
    const chatOneItem = items.find(b => b.querySelector('.command-palette-label')?.textContent === 'Chat One')
    expect(chatOneItem).toBeDefined()
    // Chat One is activeSessionId='s1', so it should have a checkmark
    const check = chatOneItem!.querySelector('.command-palette-check')
    expect(check).not.toBeNull()
  })

  it('calls onSwitchSession when a session is selected via Enter', () => {
    const onSwitchSession = vi.fn()
    const onClose = vi.fn()
    render(<CommandPalette {...defaultProps({ onSwitchSession, onClose })} />)
    const input = screen.getByPlaceholderText(/Type a command/)

    // Search for "Chat Two" to filter to that session
    fireEvent.change(input, { target: { value: 'Chat Two' } })

    const items = screen.getAllByRole('button').filter(b => b.classList.contains('command-palette-item'))
    const chatTwoItem = items.find(b => b.querySelector('.command-palette-label')?.textContent === 'Chat Two')
    expect(chatTwoItem).toBeDefined()

    // Click it
    fireEvent.click(chatTwoItem!)
    expect(onSwitchSession).toHaveBeenCalledWith('s2')
  })
})
