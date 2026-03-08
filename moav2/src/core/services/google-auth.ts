/**
 * Google OAuth 2.0 for Vertex AI (Gemini models).
 *
 * Flow (same pattern as Anthropic OAuth):
 * 1. Build auth URL → open in browser
 * 2. User authorizes → gets code
 * 3. User pastes code → exchange for tokens
 * 4. Use access_token for Vertex AI API calls
 * 5. Refresh automatically when expired
 *
 * Requires a Google OAuth Client ID (Desktop type) configured in
 * Google Cloud Console. The client_id and client_secret are stored
 * in env/config — for desktop OAuth clients, the secret is not
 * truly secret (shipped in binaries, same as gcloud CLI).
 */

// Google OAuth endpoints
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const PROJECTS_URL = 'https://cloudresourcemanager.googleapis.com/v1/projects'

// Scopes needed for Vertex AI + project listing
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
].join(' ')

// PKCE: generate code verifier + challenge
function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return base64UrlEncode(array)
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(hash))
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface GoogleOAuthConfig {
  clientId: string
  clientSecret: string
}

export interface GoogleOAuthTokens {
  access_token: string
  refresh_token: string
  expires_at: number  // Unix ms
  token_type: string
}

export interface GcpProject {
  projectId: string
  name: string
  projectNumber: string
}

// In-memory state for the current OAuth flow
let _codeVerifier: string | null = null

/**
 * Get the configured OAuth client credentials.
 * Reads from environment or hardcoded config.
 */
export function getOAuthConfig(): GoogleOAuthConfig | null {
  // Check environment first (for development)
  const clientId = (import.meta as any).env?.VITE_GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = (import.meta as any).env?.VITE_GOOGLE_OAUTH_CLIENT_SECRET

  if (clientId && clientSecret) {
    return { clientId, clientSecret }
  }

  return null
}

/**
 * Build the Google OAuth authorization URL.
 * Opens this in the browser for the user to authorize.
 */
export async function buildAuthUrl(config: GoogleOAuthConfig): Promise<{ url: string }> {
  _codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(_codeVerifier)

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    response_type: 'code',
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  })

  return { url: `${AUTH_URL}?${params.toString()}` }
}

/**
 * Exchange the authorization code for tokens.
 */
export async function exchangeCode(
  config: GoogleOAuthConfig,
  code: string
): Promise<GoogleOAuthTokens> {
  if (!_codeVerifier) {
    throw new Error('No code verifier found — did you call buildAuthUrl first?')
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: _codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
  })

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${err}`)
  }

  const data = await res.json()
  _codeVerifier = null

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in * 1000),
    token_type: data.token_type || 'Bearer',
  }
}

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string
): Promise<{ access_token: string; expires_at: number }> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Token refresh failed (${res.status}): ${err}`)
  }

  const data = await res.json()
  return {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in * 1000),
  }
}

/**
 * Get a valid access token, refreshing if needed.
 * Returns the token string ready for Authorization header.
 */
export async function getValidAccessToken(
  config: GoogleOAuthConfig,
  stored: { refresh: string; access: string; expires: number }
): Promise<{ accessToken: string; newCreds: { refresh: string; access: string; expires: number } }> {
  // Token still valid (with 60s buffer)
  if (stored.expires > Date.now() + 60_000) {
    return {
      accessToken: stored.access,
      newCreds: stored,
    }
  }

  // Need to refresh
  const refreshed = await refreshAccessToken(config, stored.refresh)
  const newCreds = {
    refresh: stored.refresh,
    access: refreshed.access_token,
    expires: refreshed.expires_at,
  }

  return { accessToken: refreshed.access_token, newCreds }
}

/**
 * List GCP projects the authenticated user has access to.
 */
export async function listProjects(accessToken: string): Promise<GcpProject[]> {
  const res = await fetch(`${PROJECTS_URL}?filter=lifecycleState:ACTIVE`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Failed to list projects (${res.status}): ${err}`)
  }

  const data = await res.json()
  return (data.projects || []).map((p: any) => ({
    projectId: p.projectId,
    name: p.name,
    projectNumber: p.projectNumber,
  }))
}
