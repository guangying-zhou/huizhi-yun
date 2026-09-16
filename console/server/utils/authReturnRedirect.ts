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

/**
 * Console's upstream login callbacks are not OIDC RP redirect endpoints.
 * They may only return to a local Console path; application callbacks are
 * already handled by the exact-match OIDC authorization flow.
 */
export function normalizeConsoleAuthReturnRedirect(value: unknown) {
  const redirect = typeof value === 'string' ? value.trim() : ''
  if (!redirect
    || !redirect.startsWith('/')
    || redirect.startsWith('//')
    || hasControlCharacter(redirect)
    || redirect.includes('\\')
    || hasUnsafeEncodedPath(redirect)) {
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
