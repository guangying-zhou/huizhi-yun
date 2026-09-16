// 目标端恢复：冷启动进入应用、且落点是首页时，若本应用存有上次访问位置，
// 就用应用自己的 router 跳过去（见 utils/appLastRoute.ts、plugins/app-last-route.client.ts）。
//
// - 用自己的 router 跳转，嵌套路由 / baseURL / query / hash 全由框架处理，不做跨应用 URL 拼接。
// - 只在「整页生命周期的首次导航且落在首页」时触发：深链直达、应用内跳转一律不劫持。
// - localStorage 仅客户端可读，服务端跳过；整页刷新（切应用回来）会重置 flag，重新判断一次。

let restoreChecked = false

export default defineNuxtRouteMiddleware((to, from) => {
  if (import.meta.server) return
  if (restoreChecked) return
  restoreChecked = true

  const pub = useRuntimeConfig().public as Record<string, unknown>
  const appCode = String(pub.appCode || '').trim()
  if (!shouldRestoreLastRouteOnLanding(appCode, to.fullPath, from.matched.length)) return

  const saved = readLastRoute(appCode)
  if (!saved || saved === '/') return

  return navigateTo(saved, { replace: true })
})
