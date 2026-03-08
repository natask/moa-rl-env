export { Type } from '@sinclair/typebox'
export * from '../../node_modules/@mariozechner/pi-ai/dist/api-registry.js'
export * from '../../node_modules/@mariozechner/pi-ai/dist/env-api-keys.js'
export * from '../../node_modules/@mariozechner/pi-ai/dist/models.js'
export * from '../../node_modules/@mariozechner/pi-ai/dist/providers/anthropic.js'
export * from '../../node_modules/@mariozechner/pi-ai/dist/providers/azure-openai-responses.js'
export * from '../../node_modules/@mariozechner/pi-ai/dist/providers/google.js'
export * from '../../node_modules/@mariozechner/pi-ai/dist/providers/google-gemini-cli.js'
export * from '../../node_modules/@mariozechner/pi-ai/dist/providers/google-vertex.js'
export * from '../../node_modules/@mariozechner/pi-ai/dist/providers/openai-completions.js'
export * from '../../node_modules/@mariozechner/pi-ai/dist/providers/openai-responses.js'
export * from '../../node_modules/@mariozechner/pi-ai/dist/types.js'
export * from '../../node_modules/@mariozechner/pi-ai/dist/utils/event-stream.js'
export * from '../../node_modules/@mariozechner/pi-ai/dist/utils/json-parse.js'
export * from '../../node_modules/@mariozechner/pi-ai/dist/utils/oauth/index.js'
export * from '../../node_modules/@mariozechner/pi-ai/dist/utils/overflow.js'
export * from '../../node_modules/@mariozechner/pi-ai/dist/utils/typebox-helpers.js'
export * from '../../node_modules/@mariozechner/pi-ai/dist/utils/validation.js'

import { clearApiProviders, getApiProvider, registerApiProvider } from '../../node_modules/@mariozechner/pi-ai/dist/api-registry.js'
import { streamAnthropic, streamSimpleAnthropic } from '../../node_modules/@mariozechner/pi-ai/dist/providers/anthropic.js'
import { streamAzureOpenAIResponses, streamSimpleAzureOpenAIResponses } from '../../node_modules/@mariozechner/pi-ai/dist/providers/azure-openai-responses.js'
import { streamGoogle, streamSimpleGoogle } from '../../node_modules/@mariozechner/pi-ai/dist/providers/google.js'
import { streamGoogleGeminiCli, streamSimpleGoogleGeminiCli } from '../../node_modules/@mariozechner/pi-ai/dist/providers/google-gemini-cli.js'
import { streamGoogleVertex, streamSimpleGoogleVertex } from '../../node_modules/@mariozechner/pi-ai/dist/providers/google-vertex.js'
import { streamGoogleVertexExpress, streamSimpleGoogleVertexExpress } from '../core/services/google-vertex-express'
import { streamOpenAICodexResponses, streamSimpleOpenAICodexResponses } from '../../node_modules/@mariozechner/pi-ai/dist/providers/openai-codex-responses.js'
import { streamOpenAICompletions, streamSimpleOpenAICompletions } from '../../node_modules/@mariozechner/pi-ai/dist/providers/openai-completions.js'
import { streamOpenAIResponses, streamSimpleOpenAIResponses } from '../../node_modules/@mariozechner/pi-ai/dist/providers/openai-responses.js'
import { getEnvApiKey } from '../../node_modules/@mariozechner/pi-ai/dist/env-api-keys.js'

export { getEnvApiKey }

function resolveApiProvider(api: string) {
  const provider = getApiProvider(api as any)
  if (!provider) {
    throw new Error(`No API provider registered for api: ${api}`)
  }
  return provider
}

export function stream(model: any, context: any, options?: any) {
  const provider = resolveApiProvider(model.api)
  return provider.stream(model, context, options)
}

export async function complete(model: any, context: any, options?: any) {
  const s = stream(model, context, options)
  return s.result()
}

export function streamSimple(model: any, context: any, options?: any) {
  const provider = resolveApiProvider(model.api)
  return provider.streamSimple(model, context, options)
}

export async function completeSimple(model: any, context: any, options?: any) {
  const s = streamSimple(model, context, options)
  return s.result()
}

export function registerBuiltInApiProviders() {
  registerApiProvider({ api: 'anthropic-messages', stream: streamAnthropic, streamSimple: streamSimpleAnthropic })
  registerApiProvider({ api: 'openai-completions', stream: streamOpenAICompletions, streamSimple: streamSimpleOpenAICompletions })
  registerApiProvider({ api: 'openai-responses', stream: streamOpenAIResponses, streamSimple: streamSimpleOpenAIResponses })
  registerApiProvider({ api: 'azure-openai-responses', stream: streamAzureOpenAIResponses, streamSimple: streamSimpleAzureOpenAIResponses })
  registerApiProvider({ api: 'openai-codex-responses', stream: streamOpenAICodexResponses, streamSimple: streamSimpleOpenAICodexResponses })
  registerApiProvider({ api: 'google-generative-ai', stream: streamGoogle, streamSimple: streamSimpleGoogle })
  registerApiProvider({ api: 'google-gemini-cli', stream: streamGoogleGeminiCli, streamSimple: streamSimpleGoogleGeminiCli })
  registerApiProvider({ api: 'google-vertex', stream: streamGoogleVertex, streamSimple: streamSimpleGoogleVertex })
  registerApiProvider({ api: 'google-vertex-express', stream: streamGoogleVertexExpress, streamSimple: streamSimpleGoogleVertexExpress })
}

export function resetApiProviders() {
  clearApiProviders()
  registerBuiltInApiProviders()
}

registerBuiltInApiProviders()
