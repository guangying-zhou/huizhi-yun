export const WECOM_DEFAULT_API_BASE = 'https://qyapi.weixin.qq.com'
export const WECOM_API_BASE_INVALID_CODE = 'platform_wecom_api_base_invalid'

export class WecomApiBaseError extends Error {
  readonly code = WECOM_API_BASE_INVALID_CODE
  constructor() {
    super(WECOM_API_BASE_INVALID_CODE)
    this.name = 'WecomApiBaseError'
  }
}

function isTailnetIPv4(host: string) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return false
  const [first, second, ...rest] = match.slice(1).map(Number) as [number, number, number, number]
  if ([first, second, ...rest].some(octet => octet > 255)) return false
  // 100.64.0.0/10 => 100.64.0.0 - 100.127.255.255
  return first === 100 && second >= 64 && second <= 127
}

/**
 * Validate the server-only WeCom API base. Fails closed with a fixed error code.
 * Allowed: the official endpoint, or http://<tailnet IPv4 in 100.64.0.0/10>:<port>
 * (WireGuard encrypts that hop) with no path, query, fragment or credentials.
 * Returns a normalized origin without a trailing slash.
 */
export function resolvePlatformWecomApiBase(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return WECOM_DEFAULT_API_BASE

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new WecomApiBaseError()
  }

  if (url.username || url.password || /[?#]/.test(raw) || (url.pathname !== '/' && url.pathname !== '')) {
    throw new WecomApiBaseError()
  }

  if (url.protocol === 'https:') {
    if (url.hostname === 'qyapi.weixin.qq.com' && !url.port) return WECOM_DEFAULT_API_BASE
    throw new WecomApiBaseError()
  }

  if (url.protocol === 'http:') {
    // URL drops the default port 80, so also require the port literally in the text.
    if (!isTailnetIPv4(url.hostname) || !url.port || !/:\d+\/?$/.test(raw)) throw new WecomApiBaseError()
    return `http://${url.hostname}:${url.port}`
  }

  throw new WecomApiBaseError()
}

export function buildPlatformWecomApiUrl(apiBase: string, path: string) {
  return new URL(`${apiBase}${path}`)
}
