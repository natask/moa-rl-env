import { describe, it, expect } from 'vitest'
import { WINDOW_CONSTRAINTS } from '../electron/window-constraints'

describe('WINDOW_CONSTRAINTS', () => {
  it('enforces a minimum width to prevent resize thrashing', () => {
    expect(WINDOW_CONSTRAINTS.minWidth).toBeGreaterThanOrEqual(480)
  })

  it('enforces a minimum height to prevent resize thrashing', () => {
    expect(WINDOW_CONSTRAINTS.minHeight).toBeGreaterThanOrEqual(360)
  })

  it('default size is larger than minimum', () => {
    expect(WINDOW_CONSTRAINTS.width).toBeGreaterThan(WINDOW_CONSTRAINTS.minWidth)
    expect(WINDOW_CONSTRAINTS.height).toBeGreaterThan(WINDOW_CONSTRAINTS.minHeight)
  })
})
