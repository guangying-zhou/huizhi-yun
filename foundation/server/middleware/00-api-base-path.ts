import { getHeader, getRequestURL, type H3Event } from 'h3'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function normalizePrefix(value: unknown) {
  const raw = stringValue(value)
  if (!raw || raw === '/') return ''
  const withStart = raw.startsWith('/') ? raw : `/${raw}`
  return withStart.replace(/\/+$/, '')
}

function configuredPrefixes(event: H3Event) {
  const config = useRuntimeConfig(event) as {
    app?: { baseURL?: string }
    public?: {
      appBasePath?: string
      appBaseURL?: string
    }
  }

  return [
    getHeader(event, 'x-forwarded-prefix'),
    config.public?.appBasePath,
    config.public?.appBaseURL,
    config.app?.baseURL
  ]
    .map(normalizePrefix)
    .filter(Boolean)
}

export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  const pathname = url.pathname

  for (const prefix of configuredPrefixes(event)) {
    if (pathname !== `${prefix}/api` && !pathname.startsWith(`${prefix}/api/`)) continue

    event.context.hzyOriginalApiUrl = event.node.req.url
    event.node.req.url = `${pathname.slice(prefix.length) || '/'}${url.search}`
    return
  }
})
