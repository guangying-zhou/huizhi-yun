const CROSS_MODULE_SEGMENTS = new Set([
  'aims',
  'assets',
  'altoc',
  'align',
  'console',
  'enterprise',
  'finance',
  'insights',
  'people',
  'platform',
  'workflow',
  'collab',
  'account'
])

function decodePathname(pathname) {
  let decoded = pathname
  for (let index = 0; index < 3; index += 1) {
    const next = decodeURIComponent(decoded)
    if (next === decoded) return decoded
    decoded = next
  }
  return decoded
}

function assertLocalPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('Expected a local module path')
  }

  const pathname = path.split(/[?#]/, 1)[0]
  let decoded = path
  try {
    decoded = decodePathname(pathname)
  } catch {
    throw new Error('Expected a local module path')
  }

  if (decoded.startsWith('//') || decoded.includes('//') || decoded.includes('\\') || decoded.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new Error('Expected a local module path')
  }

  return decoded
}

export function modulePath(module, hosted, path) {
  if (module !== 'codocs') throw new Error('Codocs module path required')
  const decodedPathname = assertLocalPath(path)

  const prefix = `/${module}`
  const firstSegment = decodedPathname.slice(1).split('/', 1)[0]
  if (CROSS_MODULE_SEGMENTS.has(firstSegment) && firstSegment !== module) {
    throw new Error('Cross-module path is not a local module path')
  }

  if (!hosted) return path
  if (path === prefix || path.startsWith(`${prefix}/`)) return path
  return `${prefix}${path}`
}

export function codocsDocumentPath(hosted, uuid) {
  const value = String(uuid || '')
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) throw new Error('Invalid Codocs document UUID')
  return modulePath('codocs', hosted, `/documents/${encodeURIComponent(value)}`)
}
