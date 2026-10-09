// 记录当前应用的「上次访问位置」，供恢复中间件读取（见 middleware/app-last-route.global.ts）。
//
// 真值来源是离开页面时刻的 window.location（pagehide / 切到后台），不依赖 vue-router 事件——
// 页签若用 history API 改 URL，afterEach 抓不到，但离开时的地址栏一定是对的。
// afterEach 仅作正常路由跳转的兜底，让记忆在页面存活期间也保持新鲜。

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const pub = config.public as Record<string, unknown>
  const appCode = String(pub.appCode || '').trim()
  if (!appCode) return

  const baseURL = String(config.app?.baseURL || '/')

  const router = useRouter()

  router.afterEach((to) => {
    if (!to.matched.length) return
    if (isApplicationShellUrl(to.fullPath, window.location.origin)) return
    saveLastRoute(appCode, to.fullPath)
  })

  const captureFromAddressBar = () => {
    if (!router.currentRoute.value.matched.length) return
    if (isApplicationShellUrl(router.currentRoute.value.fullPath, window.location.origin)) return
    saveLastRoute(appCode, currentAppRelativePath(baseURL))
  }

  window.addEventListener('pagehide', captureFromAddressBar)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') captureFromAddressBar()
  })
})
