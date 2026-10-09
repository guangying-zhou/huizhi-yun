export default defineNuxtPlugin((nuxtApp) => {
  const { embedded } = useApplicationShell()
  if (!embedded.value || window.parent === window) return

  const config = useRuntimeConfig()
  const pub = (config.public || {}) as Record<string, unknown>
  const appCode = String(pub.appCode || pub.appName || '').trim()
  if (!appCode) return

  const appName = String(pub.appDisplayName || pub.appName || appCode).trim() || appCode
  const appLogo = (() => {
    const value = String(pub.appLogo || '').trim()
    if (!value) return ''

    try {
      const baseURL = new URL(String(config.app?.baseURL || '/'), window.location.origin)
      const logoURL = new URL(value, baseURL)
      return logoURL.origin === window.location.origin ? logoURL.toString() : ''
    } catch {
      return ''
    }
  })()

  const router = useRouter()
  const postNavigation = () => {
    const path = stripApplicationShellEmbedParam(window.location.href, window.location.origin)
    window.parent.postMessage({
      type: 'hzy:shell:navigation',
      version: APPLICATION_SHELL_MESSAGE_VERSION,
      appCode,
      appName,
      logo: appLogo,
      path,
      title: document.title
    }, window.location.origin)
  }

  router.afterEach(() => {
    void nextTick(postNavigation)
  })
  nuxtApp.hook('app:mounted', postNavigation)
})
