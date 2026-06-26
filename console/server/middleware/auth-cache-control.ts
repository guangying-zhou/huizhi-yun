import { defineEventHandler, getRequestURL, setHeader } from 'h3'

const NO_STORE_PATHS = new Set([
  '/login'
])

const NO_STORE_PREFIXES = [
  '/api/auth/',
  '/api/v1/console/auth/',
  '/oauth/'
]

function matchesPath(pathname: string, path: string) {
  return pathname === path || pathname.endsWith(path)
}

function matchesPrefix(pathname: string, prefix: string) {
  return pathname.startsWith(prefix) || pathname.includes(prefix)
}

function shouldDisableAuthCache(pathname: string) {
  return Array.from(NO_STORE_PATHS).some(path => matchesPath(pathname, path))
    || NO_STORE_PREFIXES.some(prefix => matchesPrefix(pathname, prefix))
}

export default defineEventHandler((event) => {
  const pathname = getRequestURL(event).pathname
  if (!shouldDisableAuthCache(pathname)) return

  setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  setHeader(event, 'Pragma', 'no-cache')
  setHeader(event, 'Expires', '0')
  setHeader(event, 'Vary', 'Host, Cookie')
})
