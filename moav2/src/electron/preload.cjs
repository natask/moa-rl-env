// Minimal preload — stubs undici for pi-ai compatibility in Electron
const Module = require('module')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'undici') {
    return require.resolve('./undici-stub.cjs')
  }
  return originalResolve.call(this, request, parent, isMain, options)
}

// ── CORS bypass for Anthropic OAuth ──
// pi-ai's OAuth code calls fetch() from the renderer to exchange tokens at
// console.anthropic.com. Chromium blocks this due to CORS (no Access-Control
// headers on the response). Override fetch for Anthropic URLs to use Node's
// https module which has no CORS restrictions.
const https = require('https')
const origFetch = globalThis.fetch

globalThis.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url)
  if (url && (
    url.includes('console.anthropic.com') ||
    url.includes('oauth2.googleapis.com') ||
    url.includes('cloudresourcemanager.googleapis.com') ||
    url.includes('aiplatform.googleapis.com')
  )) {
    return nodeHttpsFetch(url, init || {})
  }
  return origFetch.call(globalThis, input, init)
}

function nodeHttpsFetch(url, options) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const headers = {}

    if (options.headers) {
      if (typeof options.headers.forEach === 'function') {
        options.headers.forEach((v, k) => { headers[k] = v })
      } else if (typeof options.headers === 'object') {
        Object.assign(headers, options.headers)
      }
    }

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: headers,
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          const responseHeaders = {}
          for (const [k, v] of Object.entries(res.headers)) {
            if (v) responseHeaders[k] = Array.isArray(v) ? v.join(', ') : v
          }
          resolve(
            new Response(body, {
              status: res.statusCode,
              statusText: res.statusMessage,
              headers: new Headers(responseHeaders),
            })
          )
        })
      }
    )
    req.on('error', reject)
    if (options.body) {
      req.write(
        typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body)
      )
    }
    req.end()
  })
}
