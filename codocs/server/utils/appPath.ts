import { getConfiguredAppBasePath } from '@hzy/foundation/server/utils/appUrls'
import type { H3Event } from 'h3'

export function withCurrentAppBase(event: H3Event, path: string | null | undefined) {
  const value = String(path || '').trim()
  if (!value) return value
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value

  const basePath = getConfiguredAppBasePath(event)
  if (basePath === '/') return value
  if (value === basePath || value.startsWith(basePath)) return value
  if (!value.startsWith('/')) return value

  return `${basePath}${value.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/')
}

export function rewriteCurrentAppAssetUrls(event: H3Event, content: string) {
  const value = String(content || '')
  if (!value) return value

  return value.replace(
    /(^|[\s("'=])\/api\/oss\/(image|avatar)\?([^)\s"'<>]+)/g,
    (_match, prefix: string, resource: string, query: string) => {
      const rewritten = withCurrentAppBase(event, `/api/oss/${resource}?${query}`)
      return `${prefix}${rewritten}`
    }
  )
}
