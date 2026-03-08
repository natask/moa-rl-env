/**
 * Pin system tests.
 *
 * Tests the tab sorting logic used across sessions, terminal tabs, and
 * browser tabs.  The core `sortTabs` function lives in db.ts but is not
 * exported, so we replicate it here for direct unit testing.
 *
 * We also test the pin/unpin sort-order assignment logic that lives in
 * App.tsx (pinSession, pinTerminalTab, pinBrowserTab).
 */
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// Replicated sortTabs from db.ts (not exported)
// ---------------------------------------------------------------------------

interface TabLike {
  id: string
  pinned: boolean
  sortOrder: number
}

/** Sort tabs: pinned first (by sortOrder), then unpinned (by sortOrder) */
function sortTabs<T extends TabLike>(tabs: T[]): T[] {
  return [...tabs].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return a.sortOrder - b.sortOrder
  })
}

// ---------------------------------------------------------------------------
// sortTabs tests
// ---------------------------------------------------------------------------

describe('sortTabs', () => {
  it('places pinned tabs before unpinned tabs', () => {
    const tabs: TabLike[] = [
      { id: 'u1', pinned: false, sortOrder: 0 },
      { id: 'p1', pinned: true, sortOrder: 0 },
      { id: 'u2', pinned: false, sortOrder: 1 },
    ]
    const sorted = sortTabs(tabs)
    expect(sorted[0].id).toBe('p1')
    expect(sorted[1].id).toBe('u1')
    expect(sorted[2].id).toBe('u2')
  })

  it('sorts pinned tabs by sortOrder among themselves', () => {
    const tabs: TabLike[] = [
      { id: 'p2', pinned: true, sortOrder: 2 },
      { id: 'p1', pinned: true, sortOrder: 1 },
      { id: 'p3', pinned: true, sortOrder: 3 },
    ]
    const sorted = sortTabs(tabs)
    expect(sorted.map(t => t.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('sorts unpinned tabs by sortOrder among themselves', () => {
    const tabs: TabLike[] = [
      { id: 'u3', pinned: false, sortOrder: 3 },
      { id: 'u1', pinned: false, sortOrder: 1 },
      { id: 'u2', pinned: false, sortOrder: 2 },
    ]
    const sorted = sortTabs(tabs)
    expect(sorted.map(t => t.id)).toEqual(['u1', 'u2', 'u3'])
  })

  it('handles empty array', () => {
    expect(sortTabs([])).toEqual([])
  })

  it('handles single pinned tab', () => {
    const tabs: TabLike[] = [{ id: 'p1', pinned: true, sortOrder: 0 }]
    expect(sortTabs(tabs)).toEqual(tabs)
  })

  it('handles single unpinned tab', () => {
    const tabs: TabLike[] = [{ id: 'u1', pinned: false, sortOrder: 0 }]
    expect(sortTabs(tabs)).toEqual(tabs)
  })

  it('does not mutate the input array', () => {
    const tabs: TabLike[] = [
      { id: 'u1', pinned: false, sortOrder: 0 },
      { id: 'p1', pinned: true, sortOrder: 0 },
    ]
    const original = [...tabs]
    sortTabs(tabs)
    expect(tabs).toEqual(original)
  })

  it('correctly interleaves when pinned sortOrders are higher than unpinned', () => {
    // Pinned tabs should still come first regardless of absolute sortOrder value
    const tabs: TabLike[] = [
      { id: 'u1', pinned: false, sortOrder: 0 },
      { id: 'p1', pinned: true, sortOrder: 100 },
      { id: 'u2', pinned: false, sortOrder: 1 },
      { id: 'p2', pinned: true, sortOrder: 50 },
    ]
    const sorted = sortTabs(tabs)
    // Pinned first (sorted by sortOrder: 50, 100), then unpinned (0, 1)
    expect(sorted.map(t => t.id)).toEqual(['p2', 'p1', 'u1', 'u2'])
  })

  it('preserves stable order for tabs with equal sortOrder and pin state', () => {
    // JavaScript sort is not guaranteed to be stable in all engines,
    // but modern V8 (used by Node/Vitest) is stable. We test the
    // expected behavior.
    const tabs: TabLike[] = [
      { id: 'a', pinned: false, sortOrder: 0 },
      { id: 'b', pinned: false, sortOrder: 0 },
    ]
    const sorted = sortTabs(tabs)
    // With equal sortOrder, order should be stable (a before b)
    expect(sorted[0].id).toBe('a')
    expect(sorted[1].id).toBe('b')
  })
})

// ---------------------------------------------------------------------------
// Pin assignment logic (from App.tsx pinSession/pinTerminalTab/pinBrowserTab)
// ---------------------------------------------------------------------------

describe('pin sortOrder assignment', () => {
  // When pinning a tab, the app sets:
  //   sortOrder = max(pinned sortOrders) + 1
  // This places the newly pinned tab at the bottom of the pinned section.

  function computePinSortOrder(tabs: TabLike[]): number {
    const pinnedTabs = tabs.filter(t => t.pinned)
    const maxPinnedOrder = pinnedTabs.length > 0
      ? Math.max(...pinnedTabs.map(t => t.sortOrder))
      : -1
    return maxPinnedOrder + 1
  }

  it('assigns sortOrder 0 when no tabs are pinned', () => {
    const tabs: TabLike[] = [
      { id: 'u1', pinned: false, sortOrder: 0 },
      { id: 'u2', pinned: false, sortOrder: 1 },
    ]
    expect(computePinSortOrder(tabs)).toBe(0)
  })

  it('assigns sortOrder = max + 1 when tabs are already pinned', () => {
    const tabs: TabLike[] = [
      { id: 'p1', pinned: true, sortOrder: 0 },
      { id: 'p2', pinned: true, sortOrder: 3 },
      { id: 'u1', pinned: false, sortOrder: 5 },
    ]
    // max pinned sortOrder is 3, so new pin gets 4
    expect(computePinSortOrder(tabs)).toBe(4)
  })

  it('assigns correct sortOrder with single pinned tab', () => {
    const tabs: TabLike[] = [
      { id: 'p1', pinned: true, sortOrder: 7 },
    ]
    expect(computePinSortOrder(tabs)).toBe(8)
  })

  it('ignores unpinned sortOrders when computing pin position', () => {
    const tabs: TabLike[] = [
      { id: 'u1', pinned: false, sortOrder: 100 },
      { id: 'p1', pinned: true, sortOrder: 2 },
    ]
    // Only pinned sortOrders matter; max is 2
    expect(computePinSortOrder(tabs)).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Reorder logic (from App.tsx reorderSessions/reorderTerminalTabs etc.)
// ---------------------------------------------------------------------------

describe('reorder tabs', () => {
  // After drag-and-drop, the app:
  // 1. Splices the item from fromIndex, inserts at toIndex
  // 2. Recalculates sortOrder = index for all items

  function reorderTabs(tabs: TabLike[], fromIndex: number, toIndex: number): TabLike[] {
    const reordered = [...tabs]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    return reordered.map((t, i) => ({ ...t, sortOrder: i }))
  }

  it('moves tab forward (lower to higher index)', () => {
    const tabs: TabLike[] = [
      { id: 'a', pinned: false, sortOrder: 0 },
      { id: 'b', pinned: false, sortOrder: 1 },
      { id: 'c', pinned: false, sortOrder: 2 },
    ]
    const result = reorderTabs(tabs, 0, 2)
    expect(result.map(t => t.id)).toEqual(['b', 'c', 'a'])
    expect(result.map(t => t.sortOrder)).toEqual([0, 1, 2])
  })

  it('moves tab backward (higher to lower index)', () => {
    const tabs: TabLike[] = [
      { id: 'a', pinned: false, sortOrder: 0 },
      { id: 'b', pinned: false, sortOrder: 1 },
      { id: 'c', pinned: false, sortOrder: 2 },
    ]
    const result = reorderTabs(tabs, 2, 0)
    expect(result.map(t => t.id)).toEqual(['c', 'a', 'b'])
    expect(result.map(t => t.sortOrder)).toEqual([0, 1, 2])
  })

  it('no-op when from and to are the same', () => {
    const tabs: TabLike[] = [
      { id: 'a', pinned: false, sortOrder: 0 },
      { id: 'b', pinned: false, sortOrder: 1 },
    ]
    const result = reorderTabs(tabs, 1, 1)
    expect(result.map(t => t.id)).toEqual(['a', 'b'])
    expect(result.map(t => t.sortOrder)).toEqual([0, 1])
  })

  it('recalculates all sortOrders sequentially', () => {
    const tabs: TabLike[] = [
      { id: 'a', pinned: true, sortOrder: 10 },
      { id: 'b', pinned: true, sortOrder: 20 },
      { id: 'c', pinned: false, sortOrder: 30 },
    ]
    const result = reorderTabs(tabs, 1, 0)
    // After reorder: [b, a, c], all sortOrders become 0, 1, 2
    expect(result.map(t => t.sortOrder)).toEqual([0, 1, 2])
  })
})

// ---------------------------------------------------------------------------
// Combined pin + sort scenario tests
// ---------------------------------------------------------------------------

describe('pin + sort integration', () => {
  it('newly pinned tab appears at bottom of pinned section after re-sort', () => {
    // Scenario: 2 pinned (sortOrder 0, 1), 2 unpinned (sortOrder 0, 1)
    // Pin the first unpinned tab -> it gets sortOrder = max(1) + 1 = 2
    const tabs: TabLike[] = [
      { id: 'p1', pinned: true, sortOrder: 0 },
      { id: 'p2', pinned: true, sortOrder: 1 },
      { id: 'u1', pinned: false, sortOrder: 0 },
      { id: 'u2', pinned: false, sortOrder: 1 },
    ]

    // Simulate pinning u1
    const pinnedSortOrder = Math.max(...tabs.filter(t => t.pinned).map(t => t.sortOrder)) + 1
    const updated = tabs.map(t =>
      t.id === 'u1' ? { ...t, pinned: true, sortOrder: pinnedSortOrder } : t
    )

    const sorted = sortTabs(updated)
    // Expected order: p1(pin,0), p2(pin,1), u1(pin,2), u2(unpin,1)
    expect(sorted.map(t => t.id)).toEqual(['p1', 'p2', 'u1', 'u2'])
    // u1 is now the last pinned item
    const pinnedIds = sorted.filter(t => t.pinned).map(t => t.id)
    expect(pinnedIds).toEqual(['p1', 'p2', 'u1'])
  })

  it('unpinned tab falls to the unpinned section after re-sort', () => {
    const tabs: TabLike[] = [
      { id: 'p1', pinned: true, sortOrder: 0 },
      { id: 'p2', pinned: true, sortOrder: 1 },
      { id: 'u1', pinned: false, sortOrder: 0 },
    ]

    // Unpin p2 (just set pinned: false, keep sortOrder)
    const updated = tabs.map(t =>
      t.id === 'p2' ? { ...t, pinned: false } : t
    )

    const sorted = sortTabs(updated)
    // p1 stays pinned first, then unpinned sorted by sortOrder: u1(0), p2(1)
    expect(sorted[0].id).toBe('p1')
    expect(sorted[0].pinned).toBe(true)
    // Unpinned section: u1 has sortOrder 0, p2 has sortOrder 1
    expect(sorted[1].id).toBe('u1')
    expect(sorted[2].id).toBe('p2')
  })

  it('handles all tabs pinned', () => {
    const tabs: TabLike[] = [
      { id: 'a', pinned: true, sortOrder: 2 },
      { id: 'b', pinned: true, sortOrder: 0 },
      { id: 'c', pinned: true, sortOrder: 1 },
    ]
    const sorted = sortTabs(tabs)
    expect(sorted.map(t => t.id)).toEqual(['b', 'c', 'a'])
  })

  it('handles all tabs unpinned', () => {
    const tabs: TabLike[] = [
      { id: 'c', pinned: false, sortOrder: 2 },
      { id: 'a', pinned: false, sortOrder: 0 },
      { id: 'b', pinned: false, sortOrder: 1 },
    ]
    const sorted = sortTabs(tabs)
    expect(sorted.map(t => t.id)).toEqual(['a', 'b', 'c'])
  })
})
