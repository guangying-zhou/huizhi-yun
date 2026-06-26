/**
 * 获取当前应用信息（名称、logo）
 *
 * 从当前应用本地 /api/user/applications 获取，只请求一次，全局缓存。
 * appCode 从 runtimeConfig.public 读取（构建时从 package.json 注入）。
 */

interface AppItem {
  appCode: string
  appName: string
  icon: string | null
  homeUrl: string | null
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

// 模块级缓存，所有 composable 实例共享
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
      const res = await $fetch<{ code: number, data: AppItem[] }>('/api/user/applications')
      const app = (res.data || []).find(a => a.appCode === appCode)
      if (app) cachedApp.value = app
    } catch {
      // 静默，使用兜底值
    }
  }

  if (import.meta.client) {
    onMounted(load)
  }

  return { appCode, appName, appLogo, load }
}
