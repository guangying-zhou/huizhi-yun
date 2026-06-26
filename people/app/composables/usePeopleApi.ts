function normalizeBasePath(value: unknown) {
  const text = String(value || '/').trim()
  if (!text || text === '/') return ''
  const normalized = `/${text.replace(/^\/+|\/+$/g, '')}`
  return normalized === '/' ? '' : normalized
}

export function peopleApiPath(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const config = useRuntimeConfig() as {
    public?: {
      appBasePath?: string
    }
    app?: {
      baseURL?: string
    }
  }
  const basePath = normalizeBasePath(config.public?.appBasePath || config.app?.baseURL)
  return `${basePath}${normalizedPath}`.replace(/\/{2,}/g, '/')
}
