export const DEFAULT_MAX_RETRIES = 4
export const DEFAULT_INITIAL_DELAY_MS = 500
export const DEFAULT_MAX_DELAY_MS = 30_000
export const DEFAULT_JITTER_RATIO = 0.25

export interface RetryAttemptInfo {
  attempt: number
  maxRetries: number
  delayMs: number
  error: unknown
}

export interface WithRetryOptions {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  jitterRatio?: number
  signal?: AbortSignal
  onRetry?: (info: RetryAttemptInfo) => void
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function createAbortError() {
  return new Error('Request was aborted')
}

export function isRetryableError(error: unknown): boolean {
  const err = error as any
  const statusCandidates = [err?.status, err?.statusCode, err?.response?.status, err?.code]
  for (const candidate of statusCandidates) {
    const status = toNumber(candidate)
    if (status === 429 || (status !== null && status >= 500 && status < 600)) {
      return true
    }
  }

  const message = [
    err?.message,
    err?.name,
    err?.code,
    err?.statusText,
    err?.cause?.message,
    typeof error === 'string' ? error : undefined,
  ]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ')
    .toLowerCase()

  if (/\b429\b/.test(message) || /\b5\d\d\b/.test(message)) {
    return true
  }

  const retryableKeywords = [
    'resource_exhausted',
    'internal',
    'unavailable',
    'deadline_exceeded',
    'econnreset',
    'econnrefused',
    'fetch failed',
    'timeout',
    'timed out',
    'rate limit',
    'overloaded',
    'capacity',
  ]

  return retryableKeywords.some(keyword => message.includes(keyword))
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw createAbortError()
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, Math.max(0, ms))

    const onAbort = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      reject(createAbortError())
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function withRetry<T>(fn: () => Promise<T>, options: WithRetryOptions = {}): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const jitterRatio = options.jitterRatio ?? DEFAULT_JITTER_RATIO

  for (let attempt = 0; ; attempt++) {
    if (options.signal?.aborted) {
      throw createAbortError()
    }

    try {
      return await fn()
    } catch (error) {
      if (options.signal?.aborted) {
        throw createAbortError()
      }
      if (attempt >= maxRetries || !isRetryableError(error)) {
        throw error
      }

      const baseDelay = Math.min(initialDelayMs * 2 ** attempt, maxDelayMs)
      const jitteredDelay = Math.min(maxDelayMs, Math.round(baseDelay * (1 + Math.random() * jitterRatio)))

      options.onRetry?.({
        attempt: attempt + 1,
        maxRetries,
        delayMs: jitteredDelay,
        error,
      })

      await sleep(jitteredDelay, options.signal)
    }
  }
}
