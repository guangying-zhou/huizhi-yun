export const APPLICATION_SHELL_EMBED_QUERY = 'hzy_embed'
export const APPLICATION_SHELL_STANDALONE_QUERY = 'standalone'
export const APPLICATION_SHELL_MESSAGE_VERSION = 1
export const APPLICATION_SHELL_NATIVE_APP_CODES = ['workspace', 'console'] as const

const applicationShellNativeApps = new Set<string>(APPLICATION_SHELL_NATIVE_APP_CODES)
const prefetchedApplicationEntries = new Set<string>()

function normalizedAppCode(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

function normalizedBasePath(value: string) {
  const withLeadingSlash = `/${String(value || '').replace(/^\/+/, '')}`
  if (withLeadingSlash === '/') return '/'
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

function pathInsideBase(pathname: string, basePath: string) {
  const normalizedBase = normalizedBasePath(basePath)
  if (normalizedBase === '/') return true
  const baseWithoutTrailingSlash = normalizedBase.replace(/\/+$/, '')
  return pathname === baseWithoutTrailingSlash || pathname.startsWith(normalizedBase)
}

function isEmbeddedApplicationPath(pathname: string, basePath: string) {
  const normalizedBase = normalizedBasePath(basePath)
  const baseWithoutTrailingSlash = normalizedBase.replace(/\/+$/, '')
  const appRelativePath = normalizedBase === '/'
    ? pathname
    : pathname === baseWithoutTrailingSlash
      ? '/'
      : `/${pathname.slice(normalizedBase.length).replace(/^\/+/, '')}`

  return appRelativePath === '/embed' || appRelativePath.startsWith('/embed/')
}

export function isApplicationShellApplication(appCode: unknown) {
  const code = normalizedAppCode(appCode)
  return /^[a-z0-9][a-z0-9-]*$/.test(code) && !applicationShellNativeApps.has(code)
}

export function isApplicationShellUrl(value: unknown, origin: string) {
  try {
    const url = new URL(String(value || ''), origin)
    return url.origin === new URL(origin).origin && /^\/shell\/[a-z0-9-]+\/?$/i.test(url.pathname)
  } catch {
    return false
  }
}

export function isSameOriginApplicationUrl(value: unknown, origin: string) {
  try {
    return new URL(String(value || ''), origin).origin === new URL(origin).origin
  } catch {
    return false
  }
}

export function applicationShellEntryUrl(
  appCode: unknown,
  targetUrl: string | null | undefined,
  origin: string,
  consoleHomeUrl?: string | null
) {
  const directTarget = String(targetUrl || '').trim()
  const code = normalizedAppCode(appCode)
  if (!directTarget || !isApplicationShellApplication(code) || isApplicationShellUrl(directTarget, origin)) {
    return directTarget
  }

  try {
    const currentOrigin = new URL(origin).origin
    // The current business app's origin need not host the Console Shell.
    if (consoleHomeUrl && new URL(consoleHomeUrl, currentOrigin).origin !== currentOrigin) return directTarget
    const target = new URL(directTarget, currentOrigin)
    if (target.origin !== currentOrigin) return directTarget

    const shell = new URL(`/shell/${encodeURIComponent(code)}`, currentOrigin)
    shell.searchParams.set('target', `${target.pathname}${target.search}${target.hash}`)
    return `${shell.pathname}${shell.search}`
  } catch {
    return directTarget
  }
}

export function applicationShellTargetUrl(
  requestedTarget: unknown,
  applicationHomeUrl: string | null | undefined,
  origin: string,
  applicationBasePath?: string | null
) {
  const homeValue = String(applicationHomeUrl || '').trim()
  if (!homeValue) return ''

  try {
    const currentOrigin = new URL(origin).origin
    const home = new URL(homeValue, currentOrigin)
    if (home.origin !== currentOrigin) return home.toString()

    const targetValue = String(requestedTarget || '').trim()
    const target = targetValue ? new URL(targetValue, currentOrigin) : home
    const configuredBasePath = String(applicationBasePath || '').trim()
    const allowedBasePath = configuredBasePath.startsWith('/')
      && !configuredBasePath.includes('://')
      && !configuredBasePath.includes('?')
      && !configuredBasePath.includes('#')
      ? configuredBasePath
      : home.pathname
    if (
      target.origin !== home.origin
      || !pathInsideBase(target.pathname, allowedBasePath)
      || isEmbeddedApplicationPath(target.pathname, allowedBasePath)
    ) {
      return home.toString()
    }

    target.searchParams.delete(APPLICATION_SHELL_EMBED_QUERY)
    target.searchParams.delete(APPLICATION_SHELL_STANDALONE_QUERY)
    return target.toString()
  } catch {
    return homeValue
  }
}

export function applicationShellStandaloneEnabled(value: unknown, origin: string) {
  try {
    const target = new URL(String(value || ''), origin)
    return target.searchParams.get(APPLICATION_SHELL_STANDALONE_QUERY) === '1'
  } catch {
    return false
  }
}

export function withApplicationShellEmbedParam(value: unknown, origin: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  try {
    const target = new URL(raw, origin)
    target.searchParams.delete(APPLICATION_SHELL_STANDALONE_QUERY)
    target.searchParams.set(APPLICATION_SHELL_EMBED_QUERY, '1')
    return target.toString()
  } catch {
    return raw
  }
}

export function withApplicationShellStandaloneParam(value: unknown, origin: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  try {
    const target = new URL(raw, origin)
    target.searchParams.delete(APPLICATION_SHELL_EMBED_QUERY)
    target.searchParams.set(APPLICATION_SHELL_STANDALONE_QUERY, '1')
    return target.toString()
  } catch {
    return raw
  }
}

export function stripApplicationShellEmbedParam(value: unknown, origin: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  try {
    const currentOrigin = new URL(origin).origin
    const target = new URL(raw, currentOrigin)
    target.searchParams.delete(APPLICATION_SHELL_EMBED_QUERY)
    target.searchParams.delete(APPLICATION_SHELL_STANDALONE_QUERY)
    const normalized = `${target.pathname}${target.search}${target.hash}`
    return target.origin === currentOrigin ? normalized : target.toString()
  } catch {
    return raw
  }
}

export function prefetchApplicationEntry(value: unknown) {
  if (!import.meta.client) return

  const raw = String(value || '').trim()
  if (!raw) return

  try {
    const target = new URL(raw, window.location.origin)
    if (target.origin !== window.location.origin) return

    const connection = (navigator as unknown as {
      connection?: { saveData?: boolean, effectiveType?: string }
    }).connection
    if (connection?.saveData || /(^|-)2g$/.test(String(connection?.effectiveType || ''))) return
    if (prefetchedApplicationEntries.has(target.toString())) return

    prefetchedApplicationEntries.add(target.toString())
    const link = document.createElement('link')
    link.rel = 'prefetch'
    link.as = 'document'
    link.href = target.toString()
    document.head.appendChild(link)
  } catch {
    // Navigation must remain available when prefetch is unsupported.
  }
}
