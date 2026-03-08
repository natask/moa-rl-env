import { describe, expect, it, vi } from 'vitest'
import { createSetSystemPromptTool } from '../core/tools/set-system-prompt-tool'

describe('set_system_prompt tool', () => {
  it('applies prompt and returns success', async () => {
    const applySystemPrompt = vi.fn(async () => {})
    const tool = createSetSystemPromptTool({ applySystemPrompt })

    const result = await tool.execute('t1', { prompt: '  new prompt  ' })

    expect(applySystemPrompt).toHaveBeenCalledWith('new prompt')
    expect((result.content[0] as any).text).toContain('updated')
    expect((result.details as any).ok).toBe(true)
  })

  it('returns validation error for empty prompt', async () => {
    const applySystemPrompt = vi.fn(async () => {})
    const tool = createSetSystemPromptTool({ applySystemPrompt })

    const result = await tool.execute('t1', { prompt: '   ' })

    expect(applySystemPrompt).not.toHaveBeenCalled()
    expect((result.content[0] as any).text).toContain('Error')
    expect((result.details as any).ok).toBe(false)
  })
})
