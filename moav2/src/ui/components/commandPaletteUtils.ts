// Pure utility functions for CommandPalette — no React dependencies.

const STORAGE_KEY = 'moa:command-recency'
const MAX_RECENCY_ENTRIES = 200

// --- Fuzzy matching ---

/**
 * Returns true if every character in `query` appears in `text` in order (case-insensitive).
 * Empty query matches everything.
 */
export function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

/**
 * Score a single-token fuzzy match — lower is better (fewer gaps between matched chars).
 * Returns -1 if no match. 0 is a perfect consecutive match.
 */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()

  let qi = 0
  let totalGap = 0
  let lastMatchIdx = -1

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (lastMatchIdx >= 0) {
        totalGap += (ti - lastMatchIdx - 1)
      }
      lastMatchIdx = ti
      qi++
    }
  }

  if (qi < q.length) return -1 // no match
  return totalGap
}

/**
 * Token-based fuzzy match: split query into space-separated tokens,
 * each token must independently fuzzy-match somewhere in the text.
 * Token order does NOT matter — "se d" matches "Delete Session".
 */
export function tokenFuzzyMatch(query: string, text: string): boolean {
  const trimmed = query.trim()
  if (!trimmed) return true
  const tokens = trimmed.split(/\s+/)
  return tokens.every(token => fuzzyMatch(token, text))
}

/**
 * Score a token-based fuzzy match. Lower is better.
 * Returns -1 if any token fails to match.
 * Score = sum of per-token fuzzy scores + order penalty.
 */
export function tokenFuzzyScore(query: string, text: string): number {
  const trimmed = query.trim()
  if (!trimmed) return 0
  const tokens = trimmed.split(/\s+/)
  const t = text.toLowerCase()

  let totalScore = 0
  for (const token of tokens) {
    const score = fuzzyScore(token, t)
    if (score === -1) return -1
    totalScore += score
  }

  // Bonus: if all tokens match in text-order, no penalty.
  // If out of order, add a small penalty per out-of-order pair.
  const positions = tokens.map(token => {
    const q = token.toLowerCase()
    // Find first match position of this token
    let qi = 0
    for (let ti = 0; ti < t.length && qi < q.length; ti++) {
      if (t[ti] === q[qi]) {
        if (qi === 0) { /* first char position tracked implicitly */ }
        qi++
      }
    }
    // Return position of first matched char
    return t.indexOf(q[0])
  })

  // Count out-of-order pairs
  let outOfOrder = 0
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] < positions[i - 1]) outOfOrder++
  }
  totalScore += outOfOrder * 5 // small penalty for each out-of-order token

  return totalScore
}

// --- Recency tracking ---

export type RecencyMap = Record<string, number>

export function getRecencyMap(): RecencyMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as RecencyMap
  } catch {
    return {}
  }
}

export function recordUsage(id: string): void {
  const map = getRecencyMap()
  map[id] = Date.now()
  const pruned = pruneRecencyMap(map, MAX_RECENCY_ENTRIES)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned))
}

export function pruneRecencyMap(map: RecencyMap, maxSize: number): RecencyMap {
  const entries = Object.entries(map)
  if (entries.length <= maxSize) return map

  // Sort by timestamp descending (most recent first), keep only maxSize
  entries.sort((a, b) => b[1] - a[1])
  const kept = entries.slice(0, maxSize)
  return Object.fromEntries(kept)
}

// --- Sorting ---

export interface SortableItem {
  id: string
  label: string
  category: string
}

/**
 * Sort items by recency (most recent first), then alphabetically by label.
 * Items with no recency entry sort after items that have one.
 */
export function sortByRecency<T extends SortableItem>(items: T[], recencyMap: RecencyMap): T[] {
  return [...items].sort((a, b) => {
    const ra = recencyMap[a.id] ?? 0
    const rb = recencyMap[b.id] ?? 0

    // Both have recency — most recent first
    if (ra && rb) return rb - ra
    // One has recency, the other doesn't — recency wins
    if (ra && !rb) return -1
    if (!ra && rb) return 1
    // Neither has recency — alphabetical
    return a.label.localeCompare(b.label)
  })
}

/**
 * Sort filtered items by token fuzzy score (best first), then recency, then alphabetical.
 */
export function sortFiltered<T extends SortableItem>(
  items: T[],
  query: string,
  recencyMap: RecencyMap,
): T[] {
  if (!query) return sortByRecency(items, recencyMap)

  return [...items].sort((a, b) => {
    const sa = tokenFuzzyScore(query, a.category + ' ' + a.label)
    const sb = tokenFuzzyScore(query, b.category + ' ' + b.label)

    // -1 means no match — push to end
    if (sa === -1 && sb !== -1) return 1
    if (sa !== -1 && sb === -1) return -1

    // Better score (lower) first
    if (sa !== sb) return sa - sb

    // Same score — recency
    const ra = recencyMap[a.id] ?? 0
    const rb = recencyMap[b.id] ?? 0
    if (ra && rb) return rb - ra
    if (ra && !rb) return -1
    if (!ra && rb) return 1

    // Alphabetical
    return a.label.localeCompare(b.label)
  })
}
