import { getRequestURL, setHeader, setResponseStatus, type H3Event } from 'h3'

function normalizeBasePath(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw || raw === '/') return ''
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`
  return withLeadingSlash.replace(/\/+$/, '')
}

function configuredBasePath(event: H3Event) {
  const config = useRuntimeConfig(event) as {
    app?: { baseURL?: string }
    public?: {
      appBasePath?: string
      appBaseURL?: string
    }
  }

  return normalizeBasePath(
    config.public?.appBasePath
    || config.public?.appBaseURL
    || config.app?.baseURL
  )
}

function isNuxtBuildAssetFallback(pathname: string, event: H3Event) {
  if (pathname.startsWith('/_nuxt/')) return true

  const basePath = configuredBasePath(event)
  return Boolean(basePath && pathname.startsWith(`${basePath}/_nuxt/`))
}

export default defineEventHandler((event) => {
  if (import.meta.dev) return

  const pathname = getRequestURL(event).pathname
  if (!isNuxtBuildAssetFallback(pathname, event)) return

  setResponseStatus(event, 404)
  setHeader(event, 'content-type', 'text/plain;charset=utf-8')
  setHeader(event, 'cache-control', 'no-store, no-cache, must-revalidate, max-age=0')
  setHeader(event, 'pragma', 'no-cache')
  return 'Build asset not found'
})
