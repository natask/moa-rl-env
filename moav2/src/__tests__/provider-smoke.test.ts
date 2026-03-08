import { describe, expect, it, vi } from 'vitest'

vi.mock('@mariozechner/pi-ai', () => ({
  getModel: vi.fn((provider: string, id: string) => ({ id, provider, api: provider === 'google-vertex' ? 'google-vertex' : 'openai-responses' })),
  getProviders: vi.fn(() => ['anthropic', 'openai-codex', 'google-vertex', 'custom-provider']),
  getModels: vi.fn((provider: string) => [{ id: 'provider-model', provider, api: 'openai-responses' }]),
}))

import { resolveModel } from '../core/services/model-resolver'
import { getAnthropicBrowserAuthError, resolveVertexFallback } from '../core/services/provider-guards'

describe('provider smoke tests', () => {
  it('falls back vertex to vertex-express when express key exists', () => {
    const resolved = resolveVertexFallback('vertex:gemini-2.5-pro', null, null, 'vx-123')
    expect(resolved.authMethod).toBe('vertex-express')
    expect(resolved.modelId).toBe('gemini-2.5-pro')
  })

  it('shows a friendly error when vertex has no credentials', () => {
    expect(() => resolveVertexFallback('vertex:gemini-2.5-pro', null, null, null)).toThrow(
      'Vertex AI is not configured. Add Vertex project/location or set a Vertex Express API key in Settings > Vertex AI.',
    )
  })

  it('blocks anthropic api key usage in browser mode', () => {
    expect(getAnthropicBrowserAuthError('anthropic-key', 'browser')).toContain('switch to OAuth')
    expect(getAnthropicBrowserAuthError('anthropic-oauth', 'browser')).toBeNull()
  })

  it('resolves anthropic oauth model', async () => {
    const model = await resolveModel({ modelId: 'claude-3-7-sonnet', authMethod: 'anthropic-oauth' })
    expect(model.provider).toBe('anthropic')
  })

  it('resolves openai oauth model', async () => {
    const model = await resolveModel({ modelId: 'gpt-5', authMethod: 'openai-oauth' })
    expect(model.provider).toBe('openai-codex')
  })

  it('resolves vertex express model', async () => {
    const model = await resolveModel({ modelId: 'gemini-2.5-pro', authMethod: 'vertex-express' })
    expect(model.provider).toBe('google-vertex')
  })

  it('resolves custom provider model', async () => {
    const model = await resolveModel({ modelId: 'unregistered-model', authMethod: 'custom-provider', providerBaseUrl: 'https://example.com' })
    expect(model.provider).toBe('custom-provider')
  })
})
