/**
 * 用户心跳上报
 *
 * 在 layout 中调用一次即可，自动定时上报用户在线状态：
 * - active: 10 分钟内有鼠标/键盘/滚动等交互
 * - idle: 10-30 分钟无交互
 * - 超过 30 分钟不上报（自然变为离线）
 *
 * 使用方式：在 layouts/default.vue 的 <script setup> 中调用 useHeartbeat()
 */

export function useHeartbeat(appCode?: string) {
  if (!import.meta.client) return

  const route = useRoute()
  const { authenticated, user } = useAuth()
  const config = useRuntimeConfig()
  const pub = config.public as Record<string, unknown>
  const code = appCode || String(pub.appCode || pub.appName || 'unknown')

  let lastActivity = Date.now()
  let timer: ReturnType<typeof setInterval> | null = null
  let stopContextWatch: (() => void) | null = null
  let reportFailed = false

  // 监听用户交互
  const onActivity = () => {
    lastActivity = Date.now()
  }

  const events = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click']

  const report = async (status: 'active' | 'idle') => {
    if (!authenticated.value || !user.value) return

    try {
      const consoleApp = code === 'console'
      await $fetch(consoleApp ? '/api/v1/heartbeat' : '/api/heartbeat', {
        method: 'POST',
        body: {
          ...(consoleApp ? { sourceApp: code } : {}),
          page: route.path,
          status
        }
      })
      reportFailed = false
    } catch (error) {
      if (!reportFailed) {
        reportFailed = true
        console.warn('[heartbeat] Presence report failed:', error instanceof Error ? error.message : String(error))
      }
    }
  }

  const startHeartbeat = () => {
    // 绑定事件
    events.forEach(e => document.addEventListener(e, onActivity, { passive: true }))

    // 登录态延迟恢复或路由切换时立即更新，避免必须等到下一轮定时器。
    stopContextWatch = watch(
      [authenticated, user, () => route.path],
      ([isAuthenticated, currentUser]) => {
        if (!isAuthenticated || !currentUser) return
        const idleMinutes = (Date.now() - lastActivity) / 60_000
        if (idleMinutes < 10) report('active')
        else if (idleMinutes < 30) report('idle')
      },
      { immediate: true }
    )

    // 每 2 分钟检查一次
    timer = setInterval(() => {
      const idleMinutes = (Date.now() - lastActivity) / 60_000

      if (idleMinutes < 10) {
        report('active')
      } else if (idleMinutes < 30) {
        report('idle')
      }
      // 超过 30 分钟不上报
    }, 120_000)
  }

  const stopHeartbeat = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    stopContextWatch?.()
    stopContextWatch = null
    events.forEach(e => document.removeEventListener(e, onActivity))
  }

  onMounted(startHeartbeat)
  onUnmounted(stopHeartbeat)
}
