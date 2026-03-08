import { describe, it, expect, beforeEach } from 'vitest'
import {
  fuzzyMatch,
  fuzzyScore,
  tokenFuzzyMatch,
  tokenFuzzyScore,
  sortByRecency,
  sortFiltered,
  recordUsage,
  getRecencyMap,
  pruneRecencyMap,
  type RecencyMap,
} from '../ui/components/commandPaletteUtils'

// --- fuzzyMatch ---

describe('fuzzyMatch', () => {
  it('matches non-contiguous characters in order', () => {
    expect(fuzzyMatch('nse', 'New Session')).toBe(true)
  })

  it('rejects characters out of order', () => {
    // "sna" — s(Session) n(sessioN) a(?) — no 'a' after 'n', so no match
    expect(fuzzyMatch('sna', 'New Session')).toBe(false)
    // "zz" — no 'z' in text at all
    expect(fuzzyMatch('zz', 'New Session')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(fuzzyMatch('AG', 'Agent')).toBe(true)
    expect(fuzzyMatch('ag', 'AGENT')).toBe(true)
  })

  it('matches single character', () => {
    expect(fuzzyMatch('s', 'Settings')).toBe(true)
    expect(fuzzyMatch('z', 'Settings')).toBe(false)
  })

  it('empty query matches everything', () => {
    expect(fuzzyMatch('', 'anything')).toBe(true)
    expect(fuzzyMatch('', '')).toBe(true)
  })

  it('query longer than text never matches', () => {
    expect(fuzzyMatch('longquery', 'ab')).toBe(false)
  })

  it('exact match works', () => {
    expect(fuzzyMatch('Agent', 'Agent')).toBe(true)
  })

  it('matches with spaces in text', () => {
    expect(fuzzyMatch('bk', 'Browser: Back')).toBe(true)
  })
})

// --- fuzzyScore ---

describe('fuzzyScore', () => {
  it('returns 0 for consecutive match', () => {
    expect(fuzzyScore('set', 'Settings')).toBe(0)
  })

  it('returns -1 for no match', () => {
    expect(fuzzyScore('xyz', 'Settings')).toBe(-1)
  })

  it('tighter match scores lower (better)', () => {
    const settingsScore = fuzzyScore('set', 'Settings')
    const selectScore = fuzzyScore('set', 'Select Model')
    // "set" in "Settings" is consecutive (gap=0)
    // "set" in "Select Model" has s-e gap
    expect(settingsScore).toBeLessThan(selectScore)
  })

  it('empty query returns 0', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })

  it('scores prefix match as 0', () => {
    expect(fuzzyScore('bro', 'Browser: Back')).toBe(0)
  })

  it('scores spread-out match higher (worse) than tight match', () => {
    // "ag" in "Agent" = consecutive = 0
    // "ag" in "Agent: Clear Input" also consecutive = 0 (same start)
    const score1 = fuzzyScore('ai', 'Agent: Clear Input')
    const score2 = fuzzyScore('ai', 'AI')
    expect(score2).toBeLessThanOrEqual(score1)
  })
})

// --- sortByRecency ---

describe('sortByRecency', () => {
  const items = [
    { id: 'a', label: 'Alpha', category: 'Test' },
    { id: 'b', label: 'Beta', category: 'Test' },
    { id: 'c', label: 'Charlie', category: 'Test' },
    { id: 'd', label: 'Delta', category: 'Test' },
  ]

  it('sorts recently used items first', () => {
    const recency: RecencyMap = {
      c: 1000,
      a: 500,
    }
    const sorted = sortByRecency(items, recency)
    expect(sorted.map(i => i.id)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('unused items sort alphabetically after used ones', () => {
    const recency: RecencyMap = { b: 100 }
    const sorted = sortByRecency(items, recency)
    expect(sorted[0].id).toBe('b')
    // remaining: Alpha, Charlie, Delta — alphabetical
    expect(sorted.slice(1).map(i => i.id)).toEqual(['a', 'c', 'd'])
  })

  it('all unused — pure alphabetical', () => {
    const sorted = sortByRecency(items, {})
    expect(sorted.map(i => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('does not mutate the original array', () => {
    const original = [...items]
    sortByRecency(items, { c: 1000 })
    expect(items).toEqual(original)
  })
})

// --- sortFiltered ---

describe('sortFiltered', () => {
  const items = [
    { id: 'settings', label: 'Settings', category: 'Settings' },
    { id: 'select-model', label: 'Select Model', category: 'Model' },
    { id: 'session-new', label: 'New Session', category: 'Session' },
  ]

  it('with query, sorts by fuzzy score first', () => {
    const sorted = sortFiltered(items, 'set', {})
    // "Settings" has score 0 (consecutive), "Select Model" has score > 0
    expect(sorted[0].id).toBe('settings')
  })

  it('with no query, sorts by recency', () => {
    const recency: RecencyMap = { 'session-new': 2000, 'settings': 1000 }
    const sorted = sortFiltered(items, '', recency)
    expect(sorted[0].id).toBe('session-new')
    expect(sorted[1].id).toBe('settings')
  })

  it('same score falls through to recency', () => {
    const recency: RecencyMap = { 'select-model': 5000 }
    // Both "Settings" and "Select Model" start with 's'
    const sorted = sortFiltered(items, 's', recency)
    // scores may differ, but if tied, recency breaks it
    const selectIdx = sorted.findIndex(i => i.id === 'select-model')
    const sessionIdx = sorted.findIndex(i => i.id === 'session-new')
    // select-model has recency, session-new doesn't — select-model should be before session-new
    // (unless score difference overrides)
    expect(selectIdx).toBeLessThan(sessionIdx)
  })

  it('matches across category + label combined', () => {
    const cmds = [
      { id: 'session-delete', label: 'Delete Session', category: 'Session' },
      { id: 'settings', label: 'Settings', category: 'Settings' },
    ]
    const matched = cmds.filter(
      item => tokenFuzzyMatch('sd', item.category + ' ' + item.label)
    )
    expect(matched.length).toBe(1)
    expect(matched[0].id).toBe('session-delete')
  })
})

// --- tokenFuzzyMatch ---

describe('tokenFuzzyMatch', () => {
  it('matches tokens in any order', () => {
    // "se d" — "se" matches Session, "d" matches Delete — order reversed in text, still matches
    expect(tokenFuzzyMatch('se d', 'Session Delete Session')).toBe(true)
  })

  it('matches single token same as fuzzyMatch', () => {
    expect(tokenFuzzyMatch('nse', 'New Session')).toBe(true)
    expect(tokenFuzzyMatch('zzz', 'New Session')).toBe(false)
  })

  it('requires ALL tokens to match', () => {
    // "se z" — "se" matches but "z" doesn't
    expect(tokenFuzzyMatch('se z', 'Session Delete')).toBe(false)
  })

  it('empty query matches everything', () => {
    expect(tokenFuzzyMatch('', 'anything')).toBe(true)
    expect(tokenFuzzyMatch('   ', 'anything')).toBe(true)
  })

  it('each token matches independently against full text', () => {
    // "d se" — both "d" and "se" match in "Delete Session"
    expect(tokenFuzzyMatch('d se', 'Delete Session')).toBe(true)
  })

  it('matches category prefix + label query', () => {
    // "buf ag" — "buf" matches "Buffer", "ag" matches "Agent"
    expect(tokenFuzzyMatch('buf ag', 'Buffer Agent')).toBe(true)
    // Reversed order still works
    expect(tokenFuzzyMatch('ag buf', 'Buffer Agent')).toBe(true)
  })
})

// --- tokenFuzzyScore ---

describe('tokenFuzzyScore', () => {
  it('returns -1 if any token fails', () => {
    expect(tokenFuzzyScore('se z', 'Session Delete')).toBe(-1)
  })

  it('in-order tokens score better than out-of-order', () => {
    // "buf ag" on "Buffer Agent" — in order
    const inOrder = tokenFuzzyScore('buf ag', 'Buffer Agent')
    // "ag buf" on "Buffer Agent" — out of order
    const outOfOrder = tokenFuzzyScore('ag buf', 'Buffer Agent')
    expect(inOrder).toBeLessThan(outOfOrder)
  })

  it('tighter matches score better', () => {
    // "set" on "Settings foo" — consecutive, score 0
    const tight = tokenFuzzyScore('set', 'Settings foo')
    // "s t" on "Settings foo" — two tokens, each matches but spread out
    const loose = tokenFuzzyScore('s t', 'Settings foo')
    expect(tight).toBeLessThanOrEqual(loose)
  })

  it('empty query returns 0', () => {
    expect(tokenFuzzyScore('', 'anything')).toBe(0)
  })
})

// --- recordUsage + getRecencyMap (localStorage) ---

describe('recordUsage / getRecencyMap', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('records and retrieves usage', () => {
    recordUsage('test-cmd')
    const map = getRecencyMap()
    expect(map['test-cmd']).toBeGreaterThan(0)
  })

  it('overwrites previous timestamp on re-use', () => {
    recordUsage('cmd-a')
    const first = getRecencyMap()['cmd-a']
    // Small delay to get different timestamp
    recordUsage('cmd-a')
    const second = getRecencyMap()['cmd-a']
    expect(second).toBeGreaterThanOrEqual(first)
  })

  it('returns empty map when localStorage is empty', () => {
    expect(getRecencyMap()).toEqual({})
  })

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem('moa:command-recency', 'not-json!!!')
    expect(getRecencyMap()).toEqual({})
  })
})

// --- pruneRecencyMap ---

describe('pruneRecencyMap', () => {
  it('keeps map as-is when under limit', () => {
    const map: RecencyMap = { a: 100, b: 200 }
    expect(pruneRecencyMap(map, 200)).toEqual(map)
  })

  it('prunes oldest entries when over limit', () => {
    const map: RecencyMap = {}
    for (let i = 0; i < 210; i++) {
      map[`cmd-${i}`] = i // timestamps 0-209
    }
    const pruned = pruneRecencyMap(map, 200)
    const ids = Object.keys(pruned)
    expect(ids.length).toBe(200)
    // Oldest (cmd-0 through cmd-9) should be gone
    expect(pruned['cmd-0']).toBeUndefined()
    expect(pruned['cmd-9']).toBeUndefined()
    // Most recent should remain
    expect(pruned['cmd-209']).toBe(209)
    expect(pruned['cmd-10']).toBe(10)
  })

  it('keeps exactly maxSize entries', () => {
    const map: RecencyMap = { a: 1, b: 2, c: 3, d: 4, e: 5 }
    const pruned = pruneRecencyMap(map, 3)
    expect(Object.keys(pruned).length).toBe(3)
    // Should keep c, d, e (most recent)
    expect(pruned['e']).toBe(5)
    expect(pruned['d']).toBe(4)
    expect(pruned['c']).toBe(3)
  })
})
