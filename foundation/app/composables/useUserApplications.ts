export interface UserApplicationItem {
  appCode: string
  appName: string
  description: string | null
  icon: string | null
  homeUrl: string | null
  basePath?: string | null
  apiBase?: string | null
  sortOrder?: number | null
  appType: string
  serviceRole?: string | null
  status?: string | null
}

const apps = ref<UserApplicationItem[]>([])
const loaded = ref(false)
const loading = ref(false)
const lastAuthFingerprint = ref('')
const lastLoadFailed = ref(false)
const sparseRetryAttempts = ref(0)

const sparseRetryDelayMs = 1200
const maxSparseRetryAttempts = 4

let authWatcherStarted = false
let sparseRetryTimer: ReturnType<typeof setTimeout> | null = null

function fetchStatusCode(error: unknown) {
  const record = error as {
    status?: number
    statusCode?: number
    response?: { status?: number, statusCode?: number }
  } | null | undefined

  return Number(record?.statusCode || record?.status || record?.response?.statusCode || record?.response?.status || 0)
}

export function isApplicationIconName(value: string | null | undefined) {
  const normalized = String(value || '').trim()
  if (!normalized) return false
  if (/^(https?:)?\/\//.test(normalized)) return false
  if (normalized.startsWith('/') || normalized.startsWith('./') || normalized.startsWith('../')) return false
  if (normalized.startsWith('data:')) return false
  return normalized.startsWith('i-') || /^[a-z0-9-]+:[a-z0-9-]+$/i.test(normalized)
}

export function getShortApplicationName(appName: string | null | undefined, appCode = '') {
  const fallback = String(appCode || '').trim()
  const normalized = String(appName || fallback).trim()
  const withoutBrand = normalized
    .replace(/^汇智云[·\-\s_]*/u, '')
    .replace(/^汇智云/u, '')
    .trim()

  return withoutBrand || normalized || fallback
}

function sortApplications(items: UserApplicationItem[]) {
  function itemOrder(item: UserApplicationItem) {
    const value = Number(item.sortOrder)
    if (Number.isFinite(value)) return value
    if (item.appCode === 'workspace') return -2000
    if (item.appCode === 'console') return -1000
    return Number.MAX_SAFE_INTEGER
  }

  return [...items].sort((a, b) => {
    return itemOrder(a) - itemOrder(b) || a.appName.localeCompare(b.appName, 'zh-CN')
  })
}

function normalizeNavigableUrl(value: string | null | undefined) {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) return normalized
  if (normalized.startsWith('//')) return `${window.location.protocol}${normalized}`

  const hostLike = /^(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?:[/?#].*)?$/i
  const withoutLeadingSlash = normalized.replace(/^\/+/, '')
  if (import.meta.client && normalized.startsWith('/') && hostLike.test(withoutLeadingSlash)) {
    return `${window.location.protocol}//${withoutLeadingSlash}`
  }
  if (normalized.startsWith('/')) return normalized

  if (import.meta.client && hostLike.test(normalized)) {
    return `${window.location.protocol}//${normalized}`
  }

  return `/${normalized.replace(/^\/+/, '')}`
}

function normalizeBasePath(value: string | null | undefined) {
  const normalized = String(value || '').trim()
  if (!normalized || normalized === '/') return ''
  const withLeading = normalized.startsWith('/') ? normalized : `/${normalized}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
}

function normalizeApplicationIcon(item: UserApplicationItem) {
  const normalized = String(item.icon || '').trim()
  if (!normalized) return null
  if (isApplicationIconName(normalized)) return normalized
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return normalized
  if (normalized.startsWith('//')) {
    return import.meta.client ? `${window.location.protocol}${normalized}` : normalized
  }

  const basePath = normalizeBasePath(item.basePath)
  if (basePath && !normalized.startsWith(basePath)) {
    return `${basePath}${normalized.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/')
  }

  return normalized
}

function normalizeApplication(item: UserApplicationItem): UserApplicationItem {
  return {
    ...item,
    icon: normalizeApplicationIcon(item),
    homeUrl: normalizeNavigableUrl(item.homeUrl)
  }
}

function refString(value: unknown) {
  return String(unref(value) || '').trim()
}

function getAuthFingerprint(auth: ReturnType<typeof useAuth> | null) {
  if (!auth) return ''

  return [
    auth.authenticated.value ? '1' : '0',
    refString(auth.user),
    refString(auth.tenant),
    refString(auth.policyVersion)
  ].join('|')
}

function businessAppCount(items: UserApplicationItem[]) {
  return items.filter(app => app.appCode !== 'workspace' && app.appCode !== 'console').length
}

function isSparseAuthenticatedResult(items: UserApplicationItem[], auth: ReturnType<typeof useAuth> | null) {
  return Boolean(auth?.authenticated.value && businessAppCount(items) === 0)
}

function shouldKeepExistingApps(nextApps: UserApplicationItem[], auth: ReturnType<typeof useAuth> | null) {
  return Boolean(
    apps.value.length
    && businessAppCount(apps.value) > 0
    && isSparseAuthenticatedResult(nextApps, auth)
  )
}

function clearSparseRetry() {
  if (!sparseRetryTimer) return
  clearTimeout(sparseRetryTimer)
  sparseRetryTimer = null
}

function scheduleSparseRetry(auth: ReturnType<typeof useAuth> | null) {
  if (!import.meta.client || !auth?.authenticated.value) return
  if (sparseRetryAttempts.value >= maxSparseRetryAttempts) return

  clearSparseRetry()
  sparseRetryAttempts.value += 1
  sparseRetryTimer = setTimeout(() => {
    sparseRetryTimer = null
    void loadApplications(true)
  }, sparseRetryDelayMs * sparseRetryAttempts.value)
}

function ensureAuthWatcher() {
  if (!import.meta.client || authWatcherStarted) return
  authWatcherStarted = true

  const auth = useAuth()
  watch(
    () => getAuthFingerprint(auth),
    (fingerprint, previousFingerprint) => {
      if (fingerprint === previousFingerprint) return

      clearSparseRetry()
      lastAuthFingerprint.value = ''
      lastLoadFailed.value = false
      sparseRetryAttempts.value = 0

      if (auth.authenticated.value) {
        loaded.value = false
        void loadApplications(true)
        return
      }

      if (!apps.value.length) {
        loaded.value = false
      }
    },
    { flush: 'post' }
  )
}

async function refreshAuthAfterUnauthorized(error: unknown, auth: ReturnType<typeof useAuth> | null) {
  if (!import.meta.client || fetchStatusCode(error) !== 401) return false
  if (!auth || !('refresh' in auth) || typeof auth.refresh !== 'function') return false

  try {
    await auth.refresh()
    return true
  } catch {
    return false
  }
}

async function fetchApplications() {
  const res = await $fetch<{ code: number, data: UserApplicationItem[] }>('/api/user/applications')
  return sortApplications((res.data || []).map(normalizeApplication).filter(app => app.homeUrl))
}

async function loadApplications(force = false) {
  ensureAuthWatcher()

  const auth = import.meta.client ? useAuth() : null
  const authFingerprint = getAuthFingerprint(auth)
  const canReuseLoadedState = loaded.value
    && !force
    && !lastLoadFailed.value
    && (!authFingerprint || authFingerprint === lastAuthFingerprint.value)
    && !isSparseAuthenticatedResult(apps.value, auth)

  if (loading.value) return apps.value
  if (canReuseLoadedState) return apps.value

  loading.value = true
  try {
    let nextApps: UserApplicationItem[]
    let keptExistingApps = false
    try {
      nextApps = await fetchApplications()
    } catch (error) {
      if (!await refreshAuthAfterUnauthorized(error, auth)) {
        throw error
      }

      nextApps = await fetchApplications()
    }

    if (shouldKeepExistingApps(nextApps, auth)) {
      keptExistingApps = true
      scheduleSparseRetry(auth)
    } else {
      apps.value = nextApps
    }
    loaded.value = true
    lastLoadFailed.value = false
    lastAuthFingerprint.value = authFingerprint

    if (keptExistingApps || isSparseAuthenticatedResult(apps.value, auth)) {
      scheduleSparseRetry(auth)
    } else {
      clearSparseRetry()
      sparseRetryAttempts.value = 0
    }
  } catch (error) {
    const statusCode = fetchStatusCode(error)
    if (!apps.value.length) {
      apps.value = []
    }
    loaded.value = true
    lastLoadFailed.value = true
    lastAuthFingerprint.value = authFingerprint

    if (statusCode !== 401 || apps.value.length) {
      scheduleSparseRetry(auth)
    }
  } finally {
    loading.value = false
  }

  return apps.value
}

export function useUserApplications() {
  return {
    apps,
    loaded,
    loading,
    loadApps: loadApplications
  }
}
