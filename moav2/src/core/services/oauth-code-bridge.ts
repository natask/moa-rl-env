interface OAuthCodeResolver {
  resolve: (code: string) => void
  reject: (error: Error) => void
}

export class OAuthCodeBridge {
  private resolver: OAuthCodeResolver | null = null
  private pendingCode: string | null = null

  cancel(reason: string) {
    const error = new Error(reason)
    this.resolver?.reject(error)
    this.resolver = null
    this.pendingCode = null
  }

  attachResolver(resolver: OAuthCodeResolver) {
    this.resolver = resolver
    if (this.pendingCode) {
      const code = this.pendingCode
      this.pendingCode = null
      this.resolver.resolve(code)
      this.resolver = null
      return true
    }
    return false
  }

  submitCode(code: string) {
    const trimmed = code.trim()
    if (!trimmed) return { accepted: false, queued: false }

    if (this.resolver) {
      this.resolver.resolve(trimmed)
      this.resolver = null
      return { accepted: true, queued: false }
    }

    this.pendingCode = trimmed
    return { accepted: false, queued: true }
  }
}
