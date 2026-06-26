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

export function useHeartbeat(appCode: string = 'codocs') {
  if (!import.meta.client) return

  const route = useRoute()
  const { user } = useAuth()

  let lastActivity = Date.now()
  let timer: ReturnType<typeof setInterval> | null = null

  // 监听用户交互
  const onActivity = () => {
    lastActivity = Date.now()
  }

  const events = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click']

  const report = async (status: 'active' | 'idle') => {
    if (!user.value) return

    try {
      await $fetch('/api/heartbeat', {
        method: 'POST',
        body: {
          sourceApp: appCode,
          page: route.path,
          status
        }
      })
    } catch {
      // 静默，不影响用户体验
    }
  }

  const startHeartbeat = () => {
    // 绑定事件
    events.forEach(e => document.addEventListener(e, onActivity, { passive: true }))

    // 立即上报一次
    report('active')

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
    events.forEach(e => document.removeEventListener(e, onActivity))
  }

  onMounted(startHeartbeat)
  onUnmounted(stopHeartbeat)
}
