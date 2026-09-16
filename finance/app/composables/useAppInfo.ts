interface AppItem {
  appCode: string
  appName: string
  icon: string | null
  homeUrl: string | null
}

function withAppBase(path: string) {
  const config = useRuntimeConfig()
  const base = String(config.public.appBasePath || config.app.baseURL || '/')
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return `${normalizedBase}${normalizedPath}`.replace(/\/{2,}/g, '/')
}

function isImageIcon(value: string | null | undefined) {
  const normalized = String(value || '').trim()
  if (!normalized) return false
  return /^(https?:)?\/\//.test(normalized)
    || normalized.startsWith('/')
    || normalized.startsWith('./')
    || normalized.startsWith('../')
    || normalized.startsWith('data:')
}

function resolveLocalAssetPath(value: string) {
  const normalized = String(value || '').trim()
  if (!normalized) return normalized
  if (/^(https?:)?\/\//.test(normalized) || normalized.startsWith('data:') || normalized.startsWith('blob:')) {
    return normalized
  }
  if (!normalized.startsWith('/')) return normalized

  try {
    const config = useRuntimeConfig()
    const baseURL = String(config.app?.baseURL || '/')
    if (baseURL === '/' || normalized.startsWith(baseURL)) return normalized
    return `${baseURL}${normalized.replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/')
  } catch {
    return normalized
  }
}

const cachedApp = ref<AppItem | null>(null)
const loaded = ref(false)

export function useAppInfo() {
  const config = useRuntimeConfig()
  const pub = config.public as Record<string, unknown>
  const appCode = String(pub.appCode || pub.appName || 'unknown')
  const fallbackName = String(pub.appDisplayName || '汇智云')
  const fallbackLogo = String(pub.appLogo || '/logo.png')

  const appName = computed(() => cachedApp.value?.appName || fallbackName)
  const appLogo = computed(() => {
    const icon = cachedApp.value?.icon
    const logo = isImageIcon(icon) ? icon || fallbackLogo : fallbackLogo
    return resolveLocalAssetPath(logo)
  })

  const load = async () => {
    if (loaded.value) return
    loaded.value = true
    try {
      const res = await $fetch<{ code: number, data: AppItem[] }>(withAppBase('/api/user/applications'))
      const app = (res.data || []).find(a => a.appCode === appCode)
      if (app) cachedApp.value = app
    } catch {
      // 使用运行时配置兜底，避免应用壳阻塞业务页面。
    }
  }

  if (import.meta.client) {
    onMounted(load)
  }

  return { appCode, appName, appLogo, load }
}
