import { describe, it, expect, vi, afterEach } from 'vitest'
import { isRetryableError, sleep, withRetry } from '../core/services/retry'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isRetryableError', () => {
  it('retries for status 429 and 5xx', () => {
    expect(isRetryableError({ status: 429 })).toBe(true)
    expect(isRetryableError({ statusCode: 503 })).toBe(true)
    expect(isRetryableError({ response: { status: 500 } })).toBe(true)
  })

  it('retries for common retryable keywords', () => {
    expect(isRetryableError({ message: 'RESOURCE_EXHAUSTED' })).toBe(true)
    expect(isRetryableError({ message: 'DEADLINE_EXCEEDED' })).toBe(true)
    expect(isRetryableError({ message: 'fetch failed' })).toBe(true)
    expect(isRetryableError({ message: 'rate limit exceeded' })).toBe(true)
    expect(isRetryableError({ message: 'At capacity right now' })).toBe(true)
    expect(isRetryableError({ code: 'ECONNREFUSED' })).toBe(true)
  })

  it('does not retry for non-retryable errors', () => {
    expect(isRetryableError({ status: 401, message: 'Invalid API key' })).toBe(false)
    expect(isRetryableError({ message: 'Model not found' })).toBe(false)
  })
})

describe('sleep', () => {
  it('resolves after delay', async () => {
    const start = Date.now()
    await sleep(5)
    expect(Date.now() - start).toBeGreaterThanOrEqual(1)
  })

  it('rejects when aborted', async () => {
    const controller = new AbortController()
    const pending = sleep(50, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow('Request was aborted')
  })
})

describe('withRetry', () => {
  it('retries retryable failures and eventually succeeds', async () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockRejectedValueOnce(new Error('Server overloaded'))
      .mockResolvedValue('ok')

    const onRetry = vi.fn()
    const result = await withRetry(fn, {
      maxRetries: 4,
      initialDelayMs: 1,
      maxDelayMs: 10,
      jitterRatio: 0,
      onRetry,
    })

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ attempt: 1, maxRetries: 4, delayMs: 1 })
    )
    expect(onRetry).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ attempt: 2, maxRetries: 4, delayMs: 2 })
    )
    randomSpy.mockRestore()
  })

  it('does not retry non-retryable failures', async () => {
    const error = new Error('Invalid API key (401)')
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(error)

    await expect(
      withRetry(fn, {
        initialDelayMs: 1,
        jitterRatio: 0,
      })
    ).rejects.toThrow('Invalid API key')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('respects max retries', async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('fetch failed'))

    await expect(
      withRetry(fn, {
        maxRetries: 2,
        initialDelayMs: 1,
        maxDelayMs: 5,
        jitterRatio: 0,
      })
    ).rejects.toThrow('fetch failed')

    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('stops retries when aborted', async () => {
    const controller = new AbortController()
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('fetch failed'))

    await expect(
      withRetry(fn, {
        maxRetries: 4,
        initialDelayMs: 50,
        jitterRatio: 0,
        signal: controller.signal,
        onRetry: () => controller.abort(),
      })
    ).rejects.toThrow('Request was aborted')

    expect(fn).toHaveBeenCalledTimes(1)
  })
})
