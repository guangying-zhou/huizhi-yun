type ErrorLike = {
  status?: number
  statusCode?: number
  statusMessage?: string
  message?: string
  data?: unknown
  response?: {
    status?: number
    _data?: unknown
  }
}

function cookieScope(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'app'
}

function validAuthorizationState(value: unknown) {
  const state = String(value || '').trim()
  return /^[A-Za-z0-9_-]{32,128}$/.test(state) ? state : ''
}

export function createConsoleOidcTransientCookieNames(scope: string, authorizationState?: string) {
  const normalizedScope = cookieScope(scope)
  const state = validAuthorizationState(authorizationState)
  const suffix = state ? `_${state}` : ''
  const prefix = `hzy_${normalizedScope}_oidc_`

  return {
    state: `${prefix}state${suffix}`,
    nonce: `${prefix}nonce${suffix}`,
    codeVerifier: `${prefix}code_verifier${suffix}`,
    redirect: `${prefix}redirect${suffix}`
  } as const
}

function objectText(value: unknown, depth = 0): string {
  if (value === undefined || value === null || depth > 4) return ''
  if (typeof value !== 'object') return String(value).trim()

  const record = value as Record<string, unknown>
  return ['message', 'statusMessage', 'error', 'code', 'data']
    .map(key => objectText(record[key], depth + 1))
    .filter(Boolean)
    .join(' ')
}

export function isConsoleOidcReauthenticationRequired(error: unknown) {
  if (!error || typeof error !== 'object') return false

  const candidate = error as ErrorLike
  const status = Number(candidate.statusCode || candidate.status || candidate.response?.status || 0)
  if (status !== 400 && status !== 401) return false

  const diagnostic = [
    candidate.message,
    candidate.statusMessage,
    objectText(candidate.data),
    objectText(candidate.response?._data)
  ]
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .join(' ')

  return /\binvalid_grant\b|missing refresh token/i.test(diagnostic)
}
