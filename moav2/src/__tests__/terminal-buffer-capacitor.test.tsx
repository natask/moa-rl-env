import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let platformType: 'browser' | 'capacitor' | 'electron' = 'capacitor'

vi.mock('../core/platform', () => ({
  getPlatform: () => ({
    type: platformType,
  }),
}))

import TerminalBuffer from '../ui/components/TerminalBuffer'

describe('TerminalBuffer capacitor mode', () => {
  it('renders capacitor terminal instead of unavailable state', () => {
    platformType = 'capacitor'
    render(<TerminalBuffer id="t1" />)
    expect(screen.queryByText(/Terminal requires desktop mode/)).toBeNull()
    expect(screen.getByText(/Mini shell/)).toBeTruthy()
  })

  it('keeps browser fallback message in plain browser mode', () => {
    platformType = 'browser'
    render(<TerminalBuffer id="t2" />)
    expect(screen.getByText(/Terminal requires desktop mode/)).toBeTruthy()
  })
})
