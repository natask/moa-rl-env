import type { AuthMethod } from './model-resolver'

export interface ResolvedProviderModel {
  authMethod: AuthMethod
  modelId: string
}

export function parseProviderModel(model: string): ResolvedProviderModel {
  const sepIdx = model.indexOf(':')
  if (sepIdx === -1) {
    return { authMethod: 'anthropic-key', modelId: model }
  }
  return {
    authMethod: model.substring(0, sepIdx),
    modelId: model.substring(sepIdx + 1),
  }
}

export function resolveVertexFallback(
  model: string,
  vertexProject: string | null,
  vertexLocation: string | null,
  vertexExpressApiKey: string | null,
): ResolvedProviderModel {
  const parsed = parseProviderModel(model)
  if (parsed.authMethod !== 'vertex') return parsed

  const hasFullVertexConfig = Boolean(vertexProject && vertexLocation)
  if (hasFullVertexConfig) return parsed

  if (vertexExpressApiKey) {
    return { authMethod: 'vertex-express', modelId: parsed.modelId }
  }

  throw new Error('Vertex AI is not configured. Add Vertex project/location or set a Vertex Express API key in Settings > Vertex AI.')
}

export function getAnthropicBrowserAuthError(authMethod: AuthMethod, platformType: 'browser' | 'electron' | 'capacitor'): string | null {
  if (platformType === 'browser' && authMethod === 'anthropic-key') {
    return 'Anthropic API keys are blocked by browser CORS policy. In Settings > Anthropic, switch to OAuth and sign in with Claude.'
  }
  return null
}
