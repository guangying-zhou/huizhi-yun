// Framework-independent Console service-token client for runtimes that are not
// Nuxt/Nitro apps (e.g. a standalone Collab process). Nuxt apps keep using
// serviceOidc.requestServiceAccessToken. No h3, no runtime config, no globals.

export type StandaloneServiceTokenConfig = {
  tokenUrl: string
  clientId: string
  clientSecret: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  now?: () => number
}

type CachedToken = { accessToken: string, expiresAt: number }

export class ServiceTokenError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

const REFRESH_MARGIN_MS = 30_000

export function createStandaloneServiceTokenClient(config: StandaloneServiceTokenConfig) {
  const tokenUrl = String(config.tokenUrl || '').trim()
  const clientId = String(config.clientId || '').trim()
  const clientSecret = String(config.clientSecret || '')
  if (!/^https?:\/\//.test(tokenUrl) || !clientId || !clientSecret) {
    throw new ServiceTokenError(503, 'Standalone service client is not configured')
  }
  const fetchImpl = config.fetchImpl || fetch
  const now = config.now || Date.now
  const cache = new Map<string, CachedToken>()
  const flights = new Map<string, Promise<string>>()

  async function request(audience: string, scope: string): Promise<CachedToken> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000)
    let response: Response
    try {
      response = await fetchImpl(tokenUrl, {
        method: 'POST',
        headers: { 'accept': 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, audience, scope, source_binding: 'service-client-policy' }),
        signal: controller.signal
      })
    } catch {
      throw new ServiceTokenError(503, 'Console service token endpoint is unavailable')
    } finally {
      clearTimeout(timer)
    }
    const payload = await response.json().catch(() => ({})) as { access_token?: unknown, expires_in?: unknown }
    if (!response.ok) {
      // Keep Console's status (401/403 stay authorization failures); never echo the body.
      throw new ServiceTokenError(response.status, `Console service token request failed (${response.status})`)
    }
    const accessToken = typeof payload.access_token === 'string' ? payload.access_token : ''
    const expiresIn = Number(payload.expires_in || 900)
    if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new ServiceTokenError(502, 'Console service token response is invalid')
    }
    return { accessToken, expiresAt: now() + expiresIn * 1000 }
  }

  return {
    /** Exact audience and scope per call; one cached token per pair. */
    async getToken(audience: string, scope: string, options: { forceRefresh?: boolean } = {}): Promise<string> {
      if (!audience || !scope || /\s/.test(scope)) throw new ServiceTokenError(400, 'Exactly one service scope is required')
      const key = `${audience}\u0000${scope}`
      const cached = cache.get(key)
      if (!options.forceRefresh && cached && cached.expiresAt > now() + REFRESH_MARGIN_MS) return cached.accessToken
      if (options.forceRefresh) cache.delete(key)
      const inFlight = flights.get(key)
      if (inFlight) return await inFlight
      const flight = request(audience, scope).then((token) => {
        cache.set(key, token)
        return token.accessToken
      }).finally(() => flights.delete(key))
      flights.set(key, flight)
      return await flight
    },
    clear() {
      cache.clear()
    }
  }
}
