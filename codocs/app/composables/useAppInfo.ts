/**
 * 获取当前应用信息（名称、logo）
 *
 * 与应用导航共用 Foundation 的用户应用清单和请求状态。
 * appCode 从 runtimeConfig.public.appCode 读取（构建时从 package.json 注入）。
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

export function useAppInfo(options: { loadOnMount?: boolean } = {}) {
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
    return isImageIcon(icon) ? icon || fallbackLogo : fallbackLogo
  })

  const load = () => loadApps()

  if (import.meta.client && options.loadOnMount !== false) {
    onMounted(() => {
      void load()
    })
  }

  return { appCode, appName, appLogo, load }
}
