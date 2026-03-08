import { describe, expect, it, vi } from 'vitest'
import { OAuthCodeBridge } from '../core/services/oauth-code-bridge'

describe('OAuthCodeBridge', () => {
  it('submits immediately when resolver is attached', () => {
    const bridge = new OAuthCodeBridge()
    const resolve = vi.fn()
    const reject = vi.fn()

    bridge.attachResolver({ resolve, reject })
    const result = bridge.submitCode('abc123')

    expect(result).toEqual({ accepted: true, queued: false })
    expect(resolve).toHaveBeenCalledWith('abc123')
    expect(reject).not.toHaveBeenCalled()
  })

  it('queues code when submitted before resolver and auto-submits when resolver appears', () => {
    const bridge = new OAuthCodeBridge()
    const resolve = vi.fn()
    const reject = vi.fn()

    const early = bridge.submitCode('late-resolver-code')
    const flushed = bridge.attachResolver({ resolve, reject })

    expect(early).toEqual({ accepted: false, queued: true })
    expect(flushed).toBe(true)
    expect(resolve).toHaveBeenCalledWith('late-resolver-code')
    expect(reject).not.toHaveBeenCalled()
  })

  it('cancels pending work and rejects active resolver', () => {
    const bridge = new OAuthCodeBridge()
    const resolve = vi.fn()
    const reject = vi.fn()

    bridge.attachResolver({ resolve, reject })
    bridge.cancel('flow reset')

    expect(reject).toHaveBeenCalledOnce()
    expect(resolve).not.toHaveBeenCalled()
  })
})
