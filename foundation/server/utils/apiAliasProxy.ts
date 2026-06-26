import { getRequestURL, proxyRequest, type H3Event } from 'h3'
import { getConfiguredAppBasePath, getRequestOrigin } from './appUrls'

function normalizeTargetPath(path: string) {
  const normalized = String(path || '').trim()
  if (!normalized) return '/'
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

export function buildCurrentAppProxyUrl(event: H3Event, path: string) {
  const requestUrl = getRequestURL(event)
  const origin = getRequestOrigin(event)
  const basePath = getConfiguredAppBasePath(event)
  const targetPath = normalizeTargetPath(path).replace(/^\/+/, '')
  const url = new URL(origin)
  url.pathname = `${basePath}${targetPath}`.replace(/\/{2,}/g, '/')
  url.search = requestUrl.search
  url.hash = ''
  return url.toString()
}

export function proxyCurrentAppPath(event: H3Event, path: string) {
  return proxyRequest(event, buildCurrentAppProxyUrl(event, path))
}
