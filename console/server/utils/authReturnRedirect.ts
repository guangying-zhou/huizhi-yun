function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
}

function hasUnsafeEncodedPath(value: string) {
  let decoded = value

  for (let pass = 0; pass < 3; pass += 1) {
    if (/%(?:2f|5c|2e)/i.test(decoded)) return true

    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      return true
    }
  }

  return hasControlCharacter(decoded)
    || decoded.includes('\\')
    || decoded.split('/').some(segment => segment === '.' || segment === '..')
}

// The Console login page sends absolute URLs. Only one on the verified Gateway public host is
// reduced to its site-relative form; every other absolute URL stays rejected.
function siteRelativeForTrustedHost(value: string, trustedHost: string) {
  if (!trustedHost || !/^https?:\/\//i.test(value)) return value
  try {
    const url = new URL(value)
    if (url.username || url.password || url.hostname.toLowerCase() !== trustedHost) return value
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return value
  }
}

/**
 * Console's upstream login callbacks are not OIDC RP redirect endpoints.
 * They may only return to a local site path; application callbacks are
 * already handled by the exact-match OIDC authorization flow.
 */
export function normalizeConsoleAuthReturnRedirect(value: unknown, options: { trustedHost?: string } = {}) {
  const trustedHost = String(options.trustedHost || '').split(':')[0]!.toLowerCase()
  const redirect = siteRelativeForTrustedHost(typeof value === 'string' ? value.trim() : '', trustedHost)
  // Encoded separators are parser confusion only in the path; a query legitimately carries
  // encoded URLs (the /oauth/authorize continuation's redirect_uri).
  const path = redirect.split(/[?#]/, 1)[0]!
  if (!redirect
    || !redirect.startsWith('/')
    || redirect.startsWith('//')
    || hasControlCharacter(redirect)
    || redirect.includes('\\')
    || hasUnsafeEncodedPath(path)) {
    return '/'
  }

  try {
    const url = new URL(redirect, 'https://console.invalid')
    if (url.origin !== 'https://console.invalid' || !url.pathname.startsWith('/')) return '/'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}
