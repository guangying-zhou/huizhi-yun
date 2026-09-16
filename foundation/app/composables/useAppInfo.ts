/**
 * 获取当前应用信息（名称、logo）
 *
 * 复用 useUserApplications 的跨应用 session 缓存，避免布局和应用启动器
 * 分别请求 /api/user/applications。
 * appCode 从 runtimeConfig.public 读取（构建时从 package.json 注入）。
 */

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

export function useAppInfo() {
  const config = useRuntimeConfig()
  const pub = config.public as Record<string, unknown>
  const appCode = String(pub.appCode || pub.appName || 'unknown')
  const fallbackName = String(pub.appDisplayName || '汇智云')
  const fallbackLogo = String(pub.appLogo || '/logo.png')
  const { apps, loadApps } = useUserApplications()
  const currentApp = computed(() => apps.value.find(app => app.appCode === appCode) || null)

  const appName = computed(() => currentApp.value?.appName || fallbackName)
  const appLogo = computed(() => {
    const icon = currentApp.value?.icon
    const logo = isImageIcon(icon) ? icon || fallbackLogo : fallbackLogo
    return resolveLocalAssetPath(logo)
  })

  const load = () => loadApps()

  if (import.meta.client) {
    onMounted(load)
  }

  return { appCode, appName, appLogo, load }
}
