import { describe, expect, it, vi } from 'vitest'

vi.mock('@mariozechner/pi-ai', () => ({
  getModel: vi.fn((provider: string, id: string) => {
    if (provider === 'google-vertex') return { id, provider, api: 'google-vertex' }
    return { id, provider, api: 'openai-responses' }
  }),
  getProviders: vi.fn(() => ['openai-codex']),
  getModels: vi.fn(() => [{ id: 'gpt-5', provider: 'openai-codex', api: 'openai-responses' }]),
}))

import { resolveModel } from '../core/services/model-resolver'

describe('model resolver openai oauth', () => {
  it('resolves openai-oauth via openai-codex provider registry', async () => {
    const model = await resolveModel({ modelId: 'gpt-5', authMethod: 'openai-oauth' })
    expect(model.provider).toBe('openai-codex')
  })

  it('resolves anthropic-oauth via anthropic provider registry', async () => {
    const model = await resolveModel({ modelId: 'claude-3-7-sonnet', authMethod: 'anthropic-oauth' })
    expect(model.provider).toBe('anthropic')
  })

  it('resolves vertex via google-vertex provider registry', async () => {
    const model = await resolveModel({ modelId: 'gemini-2.5-pro', authMethod: 'vertex' })
    expect(model.provider).toBe('google-vertex')
  })

  it('resolves vertex-express using google-vertex registry model', async () => {
    const model = await resolveModel({ modelId: 'gemini-2.5-pro', authMethod: 'vertex-express' })
    expect(model.api).toBe('google-vertex')
    expect(model.provider).toBe('google-vertex')
  })
})
