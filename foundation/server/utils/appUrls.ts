import { getHeader, getRequestURL, type H3Event } from 'h3'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function publicConfig(event: H3Event) {
  return (useRuntimeConfig(event).public || {}) as Record<string, unknown>
}

export function normalizePublicUrl(value: unknown) {
  const normalized = stringValue(value).replace(/\/+$/, '')
  if (!normalized) return null

  try {
    const url = new URL(normalized)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }

    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function normalizeBasePath(value: unknown) {
  const normalized = stringValue(value)
  if (!normalized) return null
  if (normalized === '/') return '/'
  if (!normalized.startsWith('/')) return null
  if (normalized.includes('://') || normalized.includes('?') || normalized.includes('#')) return null
  if (/\s/.test(normalized) || normalized.includes('..') || normalized.includes('//')) return null
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

export function getRequestOrigin(event: H3Event) {
  const forwardedProto = stringValue(getHeader(event, 'x-forwarded-proto')).split(',')[0]?.trim()
  const protocol = forwardedProto || getRequestURL(event).protocol.replace(/:$/, '') || 'http'
  const forwardedHost = stringValue(getHeader(event, 'x-forwarded-host')).split(',')[0]?.trim()
  const host = forwardedHost || getRequestURL(event).host
  return `${protocol.replace(/:$/, '')}://${host}`
}

export function buildAppHomeUrl(publicUrl: unknown, basePath: unknown) {
  const origin = normalizePublicUrl(publicUrl)
  const path = normalizeBasePath(basePath)
  if (!origin || !path) return null

  return `${origin}${path === '/' ? '/' : path}`
}

export function getConfiguredAppBasePath(event: H3Event) {
  const pub = publicConfig(event)
  const appBaseUrl = stringValue(pub.appBaseURL || pub.appBaseUrl || process.env.NUXT_APP_BASE_URL)
  const appBasePath = normalizeBasePath(
    pub.appBasePath
    || process.env.HZY_APP_BASE_PATH
    || (/^[a-z][a-z0-9+.-]*:\/\//i.test(appBaseUrl) ? '' : appBaseUrl)
  )

  return appBasePath || '/'
}

export function resolveCurrentAppHomeUrl(event: H3Event) {
  const pub = publicConfig(event)
  const explicit = normalizePublicUrl(
    pub.appHomeUrl
    || pub.homeUrl
    || process.env.HZY_APP_HOME_URL
    || process.env.NUXT_PUBLIC_APP_HOME_URL
  )
  if (explicit) return explicit.endsWith('/') ? explicit : `${explicit}/`

  const appBaseUrl = normalizePublicUrl(pub.appBaseURL || pub.appBaseUrl || process.env.NUXT_APP_BASE_URL)
  if (appBaseUrl) return appBaseUrl.endsWith('/') ? appBaseUrl : `${appBaseUrl}/`

  const serviceUrl = normalizePublicUrl(pub.serviceUrl)
  if (serviceUrl) return serviceUrl.endsWith('/') ? serviceUrl : `${serviceUrl}/`

  const requestHome = buildAppHomeUrl(getRequestOrigin(event), getConfiguredAppBasePath(event))
  if (requestHome) return requestHome

  const deploymentHome = buildAppHomeUrl(
    pub.deploymentPublicUrl || process.env.HZY_DEPLOYMENT_PUBLIC_URL,
    getConfiguredAppBasePath(event)
  )
  if (deploymentHome) return deploymentHome

  return `${getRequestOrigin(event)}/`
}

export function resolveCurrentAppUrl(event: H3Event, path: string) {
  const homeUrl = resolveCurrentAppHomeUrl(event)
  const normalizedPath = stringValue(path)
  if (!normalizedPath || normalizedPath === '/') return homeUrl
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalizedPath)) return normalizedPath

  const url = new URL(homeUrl)
  const basePath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
  const relativePath = normalizedPath.replace(/^\/+/, '')
  url.pathname = `${basePath}${relativePath}`.replace(/\/{2,}/g, '/')
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function deriveOidcCallbackUrl(event: H3Event) {
  return resolveCurrentAppUrl(event, '/api/auth/oidc-callback')
}

export function deriveCasCallbackUrl(event: H3Event, query: URLSearchParams) {
  return `${resolveCurrentAppUrl(event, '/api/auth/cas-callback')}?${query.toString()}`
}

export function deriveWecomCallbackUrl(event: H3Event, query: URLSearchParams) {
  return `${resolveCurrentAppUrl(event, '/api/auth/wecom-callback')}?${query.toString()}`
}
