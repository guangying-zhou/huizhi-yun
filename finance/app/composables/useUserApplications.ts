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
const lastActiveRoleCode = ref('')
let activeRoleWatcherStarted = false

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

function withAppBase(path: string) {
  const config = useRuntimeConfig()
  const base = String(config.public.appBasePath || config.app.baseURL || '/')
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return `${normalizedBase}${normalizedPath}`.replace(/\/{2,}/g, '/')
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

function activeRoleCodeValue() {
  const { activeRoleCode } = useActiveRole()
  return String(activeRoleCode.value || '').trim()
}

function ensureActiveRoleWatcher(reload: () => void) {
  if (!import.meta.client || activeRoleWatcherStarted) return
  activeRoleWatcherStarted = true

  const { activeRoleCode } = useActiveRole()
  watch(() => String(activeRoleCode.value || '').trim(), (roleCode, previousRoleCode) => {
    if (roleCode === previousRoleCode) return
    loaded.value = false
    reload()
  }, { flush: 'post' })
}

export function useUserApplications() {
  async function loadApps(force = false) {
    ensureActiveRoleWatcher(() => {
      void loadApps(true)
    })
    const roleCode = activeRoleCodeValue()
    if (loading.value) return apps.value
    if (loaded.value && !force && roleCode === lastActiveRoleCode.value) return apps.value

    loading.value = true
    try {
      const res = await $fetch<{ code: number, data: UserApplicationItem[] }>(withAppBase('/api/user/applications'), {
        query: roleCode ? { activeRoleCode: roleCode } : undefined
      })
      apps.value = sortApplications((res.data || []).map(normalizeApplication).filter(app => app.homeUrl))
      loaded.value = true
      lastActiveRoleCode.value = roleCode
    } catch {
      apps.value = []
      loaded.value = true
      lastActiveRoleCode.value = roleCode
    } finally {
      loading.value = false
    }

    return apps.value
  }

  return {
    apps,
    loaded,
    loading,
    loadApps
  }
}
