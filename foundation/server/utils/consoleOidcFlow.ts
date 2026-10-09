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

/** Retain one earlier login for two-tab use; never retain an unbounded history. */
export function consoleOidcTransientCookiesToPrune(scope: string, cookieNames: string[], retainPrevious = true) {
  const prefix = `hzy_${cookieScope(scope)}_oidc_`
  const pattern = /^(?:state|nonce|code_verifier|redirect)(?:_([A-Za-z0-9_-]{32,128}))?$/
  const owned = cookieNames.filter(name => name.startsWith(prefix) && pattern.test(name.slice(prefix.length)))
  const states = [...new Set(owned.map(name => pattern.exec(name.slice(prefix.length))?.[1]).filter(Boolean))]
  const retained = retainPrevious ? states.slice(-1) : []
  return owned.filter(name => !retained.includes(pattern.exec(name.slice(prefix.length))?.[1]))
}

export function consoleOidcTransientPath(redirectUri: string) {
  const path = new URL(redirectUri).pathname
  const first = path.split('/').filter(Boolean)[0]
  return first && first !== 'api' ? `/${first}` : '/'
}
