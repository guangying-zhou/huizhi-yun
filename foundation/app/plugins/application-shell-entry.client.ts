export default defineNuxtPlugin(() => {
  if (window.parent !== window) return

  const config = useRuntimeConfig()
  const pub = (config.public || {}) as Record<string, unknown>
  const appCode = String(pub.appCode || pub.appName || '').trim().toLowerCase()
  if (!isApplicationShellApplication(appCode)) return

  const origin = window.location.origin
  const router = useRouter()

  if (applicationShellStandaloneEnabled(window.location.href, origin)) {
    const preserveStandaloneMode = () => {
      const standaloneUrl = withApplicationShellStandaloneParam(window.location.href, origin)
      if (standaloneUrl === window.location.href) return
      window.history.replaceState(window.history.state, '', standaloneUrl)
    }

    preserveStandaloneMode()
    router.afterEach(preserveStandaloneMode)
    return
  }

  const { apps, loadApps } = useUserApplications()
  let redirecting = false

  const enterApplicationShell = () => {
    if (redirecting) return

    const application = apps.value.find(item => item.appCode === appCode)
    if (
      !application?.homeUrl
      || !isSameOriginApplicationUrl(application.homeUrl, origin)
    ) {
      return
    }

    const target = applicationShellTargetUrl(
      window.location.href,
      application.homeUrl,
      origin,
      application.basePath
    )
    const consoleHome = apps.value.find(item => item.appCode === 'workspace' || item.appCode === 'console')?.homeUrl
    const shellEntry = applicationShellEntryUrl(appCode, target, origin, consoleHome)
    if (!isApplicationShellUrl(shellEntry, origin)) return

    redirecting = true
    window.location.replace(shellEntry)
  }

  watch(apps, enterApplicationShell)
  void loadApps().then(enterApplicationShell)
})
