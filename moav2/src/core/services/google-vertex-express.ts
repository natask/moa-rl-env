/**
 * Vertex AI Express mode streaming provider.
 *
 * Uses a simple API key with `vertexai: true` in the @google/genai SDK,
 * which triggers the Express endpoint (aiplatform.googleapis.com) without
 * requiring a GCP project or location.
 */

import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import { calculateCost } from '../../../node_modules/@mariozechner/pi-ai/dist/models.js'
import { AssistantMessageEventStream } from '../../../node_modules/@mariozechner/pi-ai/dist/utils/event-stream.js'
import { sanitizeSurrogates } from '../../../node_modules/@mariozechner/pi-ai/dist/utils/sanitize-unicode.js'
import {
  convertMessages,
  convertTools,
  isThinkingPart,
  mapStopReason,
  mapToolChoice,
  retainThoughtSignature,
} from '../../../node_modules/@mariozechner/pi-ai/dist/providers/google-shared.js'
import { buildBaseOptions, clampReasoning } from '../../../node_modules/@mariozechner/pi-ai/dist/providers/simple-options.js'
import { withRetry } from './retry'

const API_VERSION = 'v1'

const THINKING_LEVEL_MAP: Record<string, any> = {
  THINKING_LEVEL_UNSPECIFIED: ThinkingLevel.THINKING_LEVEL_UNSPECIFIED,
  MINIMAL: ThinkingLevel.MINIMAL,
  LOW: ThinkingLevel.LOW,
  MEDIUM: ThinkingLevel.MEDIUM,
  HIGH: ThinkingLevel.HIGH,
}

let toolCallCounter = 0

function createClient(apiKey: string, optionsHeaders?: Record<string, string>) {
  const httpOptions: any = {}
  if (optionsHeaders) {
    httpOptions.headers = { ...optionsHeaders }
  }
  const hasHttpOptions = Object.values(httpOptions).some(Boolean)
  return new GoogleGenAI({
    apiKey,
    vertexai: true,
    // No project or location — SDK enters Express mode automatically
    apiVersion: API_VERSION,
    httpOptions: hasHttpOptions ? httpOptions : undefined,
  })
}

function buildParams(model: any, context: any, options: any = {}) {
  const contents = convertMessages(model, context)
  const generationConfig: any = {}
  if (options.temperature !== undefined) {
    generationConfig.temperature = options.temperature
  }
  if (options.maxTokens !== undefined) {
    generationConfig.maxOutputTokens = options.maxTokens
  }
  const config: any = {
    ...(Object.keys(generationConfig).length > 0 && generationConfig),
    ...(context.systemPrompt && { systemInstruction: sanitizeSurrogates(context.systemPrompt) }),
    ...(context.tools && context.tools.length > 0 && { tools: convertTools(context.tools) }),
  }
  if (context.tools && context.tools.length > 0 && options.toolChoice) {
    config.toolConfig = {
      functionCallingConfig: {
        mode: mapToolChoice(options.toolChoice),
      },
    }
  } else {
    config.toolConfig = undefined
  }
  if (options.thinking?.enabled && model.reasoning) {
    const thinkingConfig: any = { includeThoughts: true }
    if (options.thinking.level !== undefined) {
      thinkingConfig.thinkingLevel = THINKING_LEVEL_MAP[options.thinking.level]
    } else if (options.thinking.budgetTokens !== undefined) {
      thinkingConfig.thinkingBudget = options.thinking.budgetTokens
    }
    config.thinkingConfig = thinkingConfig
  }
  if (options.signal) {
    if (options.signal.aborted) {
      throw new Error('Request aborted')
    }
    config.abortSignal = options.signal
  }
  return { model: model.id, contents, config }
}

export const streamGoogleVertexExpress = (model: any, context: any, options: any) => {
  const stream = new AssistantMessageEventStream()
  ;(async () => {
    const output: any = {
      role: 'assistant',
      content: [],
      api: 'google-vertex-express',
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    }
    try {
      const apiKey = options?.apiKey
      if (!apiKey) {
        throw new Error('Vertex AI Express requires an API key. Go to Settings > Vertex AI and add your Express API key.')
      }
      const client = createClient(apiKey, options?.headers)
      const params = buildParams(model, context, options)
      options?.onPayload?.(params)
      const googleStream = await withRetry(
        () => client.models.generateContentStream(params),
        {
          signal: options?.signal,
          onRetry: ({ attempt, maxRetries, delayMs, error }) => {
            const message = error instanceof Error ? error.message : String(error)
            console.warn(`[vertex-express] Retry ${attempt}/${maxRetries} after ${delayMs}ms:`, message)
          },
        }
      )
      stream.push({ type: 'start', partial: output })
      let currentBlock: any = null
      const blocks = output.content
      const blockIndex = () => blocks.length - 1
      for await (const chunk of googleStream) {
        const candidate = (chunk as any).candidates?.[0]
        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            if (part.text !== undefined) {
              const isThinking = isThinkingPart(part)
              if (
                !currentBlock ||
                (isThinking && currentBlock.type !== 'thinking') ||
                (!isThinking && currentBlock.type !== 'text')
              ) {
                if (currentBlock) {
                  if (currentBlock.type === 'text') {
                    stream.push({
                      type: 'text_end',
                      contentIndex: blocks.length - 1,
                      content: currentBlock.text,
                      partial: output,
                    })
                  } else {
                    stream.push({
                      type: 'thinking_end',
                      contentIndex: blockIndex(),
                      content: currentBlock.thinking,
                      partial: output,
                    })
                  }
                }
                if (isThinking) {
                  currentBlock = { type: 'thinking', thinking: '', thinkingSignature: undefined }
                  output.content.push(currentBlock)
                  stream.push({ type: 'thinking_start', contentIndex: blockIndex(), partial: output })
                } else {
                  currentBlock = { type: 'text', text: '' }
                  output.content.push(currentBlock)
                  stream.push({ type: 'text_start', contentIndex: blockIndex(), partial: output })
                }
              }
              if (currentBlock.type === 'thinking') {
                currentBlock.thinking += part.text
                currentBlock.thinkingSignature = retainThoughtSignature(
                  currentBlock.thinkingSignature,
                  (part as any).thoughtSignature
                )
                stream.push({
                  type: 'thinking_delta',
                  contentIndex: blockIndex(),
                  delta: part.text,
                  partial: output,
                })
              } else {
                currentBlock.text += part.text
                currentBlock.textSignature = retainThoughtSignature(
                  currentBlock.textSignature,
                  (part as any).thoughtSignature
                )
                stream.push({
                  type: 'text_delta',
                  contentIndex: blockIndex(),
                  delta: part.text,
                  partial: output,
                })
              }
            }
            if ((part as any).functionCall) {
              if (currentBlock) {
                if (currentBlock.type === 'text') {
                  stream.push({
                    type: 'text_end',
                    contentIndex: blockIndex(),
                    content: currentBlock.text,
                    partial: output,
                  })
                } else {
                  stream.push({
                    type: 'thinking_end',
                    contentIndex: blockIndex(),
                    content: currentBlock.thinking,
                    partial: output,
                  })
                }
                currentBlock = null
              }
              const fc = (part as any).functionCall
              const providedId = fc.id
              const needsNewId =
                !providedId || output.content.some((b: any) => b.type === 'toolCall' && b.id === providedId)
              const toolCallId = needsNewId ? `${fc.name}_${Date.now()}_${++toolCallCounter}` : providedId
              const toolCall = {
                type: 'toolCall' as const,
                id: toolCallId,
                name: fc.name || '',
                arguments: fc.args ?? {},
                ...((part as any).thoughtSignature && { thoughtSignature: (part as any).thoughtSignature }),
              }
              output.content.push(toolCall)
              stream.push({ type: 'toolcall_start', contentIndex: blockIndex(), partial: output })
              stream.push({
                type: 'toolcall_delta',
                contentIndex: blockIndex(),
                delta: JSON.stringify(toolCall.arguments),
                partial: output,
              })
              stream.push({ type: 'toolcall_end', contentIndex: blockIndex(), toolCall, partial: output })
            }
          }
        }
        if (candidate?.finishReason) {
          output.stopReason = mapStopReason(candidate.finishReason)
          if (output.content.some((b: any) => b.type === 'toolCall')) {
            output.stopReason = 'toolUse'
          }
        }
        if ((chunk as any).usageMetadata) {
          const um = (chunk as any).usageMetadata
          output.usage = {
            input: um.promptTokenCount || 0,
            output: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0),
            cacheRead: um.cachedContentTokenCount || 0,
            cacheWrite: 0,
            totalTokens: um.totalTokenCount || 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          }
          calculateCost(model, output.usage)
        }
      }
      if (currentBlock) {
        if (currentBlock.type === 'text') {
          stream.push({
            type: 'text_end',
            contentIndex: blockIndex(),
            content: currentBlock.text,
            partial: output,
          })
        } else {
          stream.push({
            type: 'thinking_end',
            contentIndex: blockIndex(),
            content: currentBlock.thinking,
            partial: output,
          })
        }
      }
      if (options?.signal?.aborted) {
        throw new Error('Request was aborted')
      }
      if (output.stopReason === 'aborted' || output.stopReason === 'error') {
        throw new Error('An unknown error occurred')
      }
      stream.push({ type: 'done', reason: output.stopReason, message: output })
      stream.end()
    } catch (error: any) {
      for (const block of output.content) {
        if ('index' in block) {
          delete block.index
        }
      }
      output.stopReason = options?.signal?.aborted ? 'aborted' : 'error'
      output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error)
      stream.push({ type: 'error', reason: output.stopReason, error: output })
      stream.end()
    }
  })()
  return stream
}

function isGemini3ProModel(model: any) {
  return model.id.includes('3-pro')
}

function isGemini3FlashModel(model: any) {
  return model.id.includes('3-flash')
}

function getGemini3ThinkingLevel(effort: string, model: any): string {
  if (isGemini3ProModel(model)) {
    switch (effort) {
      case 'minimal':
      case 'low':
        return 'LOW'
      case 'medium':
      case 'high':
        return 'HIGH'
    }
  }
  switch (effort) {
    case 'minimal':
      return 'MINIMAL'
    case 'low':
      return 'LOW'
    case 'medium':
      return 'MEDIUM'
    case 'high':
      return 'HIGH'
  }
  return 'MEDIUM'
}

function getGoogleBudget(model: any, effort: string, customBudgets: any): number {
  if (customBudgets?.[effort] !== undefined) {
    return customBudgets[effort]
  }
  if (model.id.includes('2.5-pro')) {
    const budgets: Record<string, number> = { minimal: 128, low: 2048, medium: 8192, high: 32768 }
    return budgets[effort] ?? -1
  }
  if (model.id.includes('2.5-flash')) {
    const budgets: Record<string, number> = { minimal: 128, low: 2048, medium: 8192, high: 24576 }
    return budgets[effort] ?? -1
  }
  return -1
}

export const streamSimpleGoogleVertexExpress = (model: any, context: any, options: any) => {
  const base = buildBaseOptions(model, options, undefined)
  if (!options?.reasoning) {
    return streamGoogleVertexExpress(model, context, {
      ...base,
      thinking: { enabled: false },
    })
  }
  const effort = clampReasoning(options.reasoning) as string
  if (isGemini3ProModel(model) || isGemini3FlashModel(model)) {
    return streamGoogleVertexExpress(model, context, {
      ...base,
      thinking: {
        enabled: true,
        level: getGemini3ThinkingLevel(effort, model),
      },
    })
  }
  return streamGoogleVertexExpress(model, context, {
    ...base,
    thinking: {
      enabled: true,
      budgetTokens: getGoogleBudget(model, effort, options.thinkingBudgets),
    },
  })
}
