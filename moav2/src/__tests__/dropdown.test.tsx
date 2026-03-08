import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import Dropdown from '../ui/components/Dropdown'

afterEach(() => {
  cleanup()
})

describe('Dropdown', () => {
  it('opens and selects with Enter', () => {
    const onChange = vi.fn()
    render(
      <Dropdown
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
        value="a"
        onChange={onChange}
      />
    )

    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeTruthy()

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('supports Ctrl+N and Ctrl+P navigation', () => {
    render(
      <Dropdown
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
          { value: 'c', label: 'Gamma' },
        ]}
        value="a"
        onChange={() => {}}
      />
    )

    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)

    fireEvent.keyDown(trigger, { key: 'n', ctrlKey: true })
    expect(screen.getByRole('option', { name: 'Beta' }).className).toContain('highlighted')

    fireEvent.keyDown(trigger, { key: 'p', ctrlKey: true })
    expect(screen.getByRole('option', { name: /Alpha/ }).className).toContain('highlighted')
  })

  it('closes on Escape', () => {
    render(
      <Dropdown
        options={[{ value: 'a', label: 'Alpha' }]}
        value="a"
        onChange={() => {}}
      />
    )

    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('applies aria-selected to the selected value', () => {
    render(
      <Dropdown
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
        value="b"
        onChange={() => {}}
      />
    )

    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByRole('option', { name: 'Alpha' }).getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('option', { name: /Beta/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('closes on outside click and returns focus to trigger', () => {
    render(
      <>
        <button type="button">Outside</button>
        <Dropdown
          options={[{ value: 'a', label: 'Alpha' }]}
          value="a"
          onChange={() => {}}
        />
      </>
    )

    const trigger = screen.getByRole('combobox')
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeTruthy()

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
