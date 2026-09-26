const CONTROL = /[\u0000-\u001f\u007f]/

export function matchRegisteredPage(target, registeredPages) {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') || CONTROL.test(target)) return null
  const hashAt = target.indexOf('#')
  const queryAt = target.indexOf('?')
  const end = [queryAt, hashAt].filter(value => value >= 0).sort((a, b) => a - b)[0] ?? target.length
  const pathname = target.slice(0, end)
  if (/%2f|%5c/i.test(pathname) || pathname.includes('\\')) return null
  if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/auth' || pathname.startsWith('/auth/')) return null
  const segments = pathname.split('/').slice(1)
  if (segments.some(segment => segment === '.' || segment === '..')) return null
  let decoded
  try { decoded = segments.map(segment => decodeURIComponent(segment)) } catch { return null }
  if (decoded.some(segment => !segment || CONTROL.test(segment) || segment.includes('/') || segment.includes('\\') || segment === '.' || segment === '..')) return null
  const match = (pattern) => {
    const parts = pattern.split('/').slice(1)
    return parts.length === decoded.length && parts.every((part, position) => part.startsWith(':') || part === decoded[position])
  }
  return registeredPages.find(page => match(page.path)) || null
}
