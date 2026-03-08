import type { Model } from '@mariozechner/pi-ai'

export type AuthMethod = 'anthropic-key' | 'anthropic-oauth' | 'openai-oauth' | 'vertex' | 'vertex-express' | string

interface ResolveModelParams {
  modelId: string
  authMethod: AuthMethod
  providerBaseUrl?: string
}

export async function resolveModel(params: ResolveModelParams): Promise<Model<any>> {
  const piAi = await import('@mariozechner/pi-ai')
  const { modelId, authMethod } = params

  // Anthropic (both API key and OAuth use the same model objects)
  if (authMethod === 'anthropic-key' || authMethod === 'anthropic-oauth') {
    try {
      const found = piAi.getModel('anthropic', modelId as any)
      if (found) return found
    } catch {
      // Not in registry, fall through
    }
  }

  // Vertex AI
  if (authMethod === 'vertex') {
    try {
      const found = piAi.getModel('google-vertex', modelId as any)
      if (found) return found
    } catch {
      // Not in registry, fall through
    }
  }

  // Vertex AI Express (API key auth, global endpoint)
  if (authMethod === 'vertex-express') {
    try {
      const found = piAi.getModel('google-vertex', modelId as any)
      if (found) return found
    } catch {
      // Not in registry, fall through
    }
  }

  // OpenAI OAuth (Codex)
  if (authMethod === 'openai-oauth') {
    try {
      const found = piAi.getModel('openai-codex', modelId as any)
      if (found) return found
    } catch {
      // Not in registry, fall through
    }
  }

  // Custom provider — scan all known registries then fall back
  const knownProviders = piAi.getProviders()
  for (const p of knownProviders) {
    try {
      const models = piAi.getModels(p)
      const found = models.find((m: any) => m.id === modelId)
      if (found) return found
    } catch {
      // Skip
    }
  }

  // Fall back to a custom model config
  const providerBaseUrl = params.providerBaseUrl || ''
  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: authMethod || 'custom',
    baseUrl: providerBaseUrl,
    reasoning: false,
    input: ['text', 'image'] as ('text' | 'image')[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 16384,
  } as Model<any>
}

/** Get all models for a known provider from pi-ai registry */
export async function getProviderModels(provider: string): Promise<Model<any>[]> {
  const piAi = await import('@mariozechner/pi-ai')
  try {
    return piAi.getModels(provider as any)
  } catch {
    return []
  }
}
