function stringValue(value: unknown) {
  return String(value || '').trim()
}

function normalizePublicUrl(value: unknown) {
  const normalized = stringValue(value).replace(/\/+$/, '')
  if (!normalized) return null

  try {
    const url = new URL(normalized)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return null
  }
}

function normalizeBasePath(value: unknown) {
  const normalized = stringValue(value)
  if (!normalized) return '/'
  if (normalized === '/') return '/'
  if (!normalized.startsWith('/')) return '/'
  if (normalized.includes('://') || normalized.includes('?') || normalized.includes('#')) return '/'
  if (/\s/.test(normalized) || normalized.includes('..') || normalized.includes('//')) return '/'
  return normalized.endsWith('/') ? normalized : `${normalized}/`
}

function getRequestOrigin() {
  if (import.meta.client) {
    return window.location.origin
  }

  const requestUrl = useRequestURL()
  return `${requestUrl.protocol}//${requestUrl.host}`
}

function joinHomeUrl(publicUrl: string, basePath: string) {
  return `${publicUrl}${basePath === '/' ? '/' : basePath}`
}

export function useAppUrls() {
  const config = useRuntimeConfig()
  const pub = (config.public || {}) as Record<string, unknown>

  const appBasePath = computed(() => normalizeBasePath(
    pub.appBasePath
    || config.app?.baseURL
    || '/'
  ))

  const appHomeUrl = computed(() => {
    const explicit = normalizePublicUrl(pub.appHomeUrl || pub.homeUrl)
    if (explicit) return explicit.endsWith('/') ? explicit : `${explicit}/`

    if (import.meta.client) {
      return joinHomeUrl(getRequestOrigin(), appBasePath.value)
    }

    const deploymentPublicUrl = normalizePublicUrl(pub.deploymentPublicUrl)
    if (deploymentPublicUrl) {
      return joinHomeUrl(deploymentPublicUrl, appBasePath.value)
    }

    return joinHomeUrl(getRequestOrigin(), appBasePath.value)
  })

  function resolveCurrentAppUrl(path = '/') {
    const normalized = stringValue(path) || '/'
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) {
      return normalized
    }

    const url = new URL(appHomeUrl.value)
    const relativePath = normalized.replace(/^\/+/, '')
    if (!relativePath) {
      url.search = ''
      url.hash = ''
      return url.toString()
    }

    const [pathname = '', hashPart = ''] = relativePath.split('#', 2)
    const [pathPart = '', searchPart = ''] = pathname.split('?', 2)
    const basePath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
    url.pathname = `${basePath}${pathPart}`.replace(/\/{2,}/g, '/')
    url.search = searchPart ? `?${searchPart}` : ''
    url.hash = hashPart ? `#${hashPart}` : ''
    return url.toString()
  }

  function resolveCurrentAppPath(path = '/') {
    const url = new URL(resolveCurrentAppUrl(path))
    return `${url.pathname}${url.search}${url.hash}`
  }

  return {
    appBasePath,
    appHomeUrl,
    resolveCurrentAppUrl,
    resolveCurrentAppPath
  }
}
