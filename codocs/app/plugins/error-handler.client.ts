export default defineNuxtPlugin((nuxtApp) => {
  // 处理 chunk 加载失败（部署后旧缓存导致 404），自动刷新页面
  nuxtApp.hook('app:chunkError', ({ error }) => {
    console.warn('[Chunk Error] 检测到资源加载失败，即将刷新页面:', error)
    const reloadKey = 'codocs:chunk-error-reload-at'

    try {
      const lastReloadAt = Number(sessionStorage.getItem(reloadKey) || '0')
      if (lastReloadAt > 0) {
        console.error('[Chunk Error] 资源加载失败仍未恢复，已停止自动刷新以便调试:', error)
        return
      }
      sessionStorage.setItem(reloadKey, String(Date.now()))
    } catch {
      // sessionStorage 不可用时仍允许 Nuxt 内建 TTL 兜底。
    }

    reloadNuxtApp({ ttl: 300000 })
  })

  // 全局 Vue 错误处理器
  nuxtApp.vueApp.config.errorHandler = (err: unknown, instance, info) => {
    const error = err as Error | undefined
    // 忽略导航相关的 parentNode 错误
    if (
      error?.message?.includes('parentNode')
      || error?.message?.includes('Cannot read properties of null')
      || error?.message?.includes('reading \'parentNode\'')
    ) {
      console.warn(
        '[Global Error Handler] Navigation error suppressed:',
        error.message
      )
      return
    }

    // 其他错误正常处理
    console.error('[Global Error Handler]', err, info)
  }

  // 处理未捕获的 Promise 错误
  if (import.meta.client) {
    window.addEventListener('unhandledrejection', (event) => {
      if (
        event.reason?.message?.includes('parentNode')
        || event.reason?.message?.includes('Cannot read properties of null')
      ) {
        console.warn(
          '[Unhandled Promise] Navigation error suppressed:',
          event.reason.message
        )
        event.preventDefault()
        return
      }
    })
  }

  // 路由错误处理
  nuxtApp.hook('vue:error', (err: unknown) => {
    const error = err as Error | undefined
    if (
      error?.message?.includes('parentNode')
      || error?.message?.includes('Cannot read properties of null')
    ) {
      console.warn(
        '[Vue Hook Error] Navigation error suppressed:',
        error.message
      )
      return
    }
  })
})
