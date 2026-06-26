export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.config.errorHandler = (err: unknown, instance, info) => {
    const errorLike = (typeof err === 'object' && err !== null) ? err as { message?: string } : null
    if (
      errorLike?.message?.includes('parentNode')
      || errorLike?.message?.includes('Cannot read properties of null')
      || errorLike?.message?.includes('reading \'parentNode\'')
    ) {
      console.warn('[Global Error Handler] Navigation error suppressed:', errorLike?.message)
      return
    }
    console.error('[Global Error Handler]', err, info)
  }

  if (import.meta.client) {
    window.addEventListener('unhandledrejection', (event) => {
      if (
        event.reason?.message?.includes('parentNode')
        || event.reason?.message?.includes('Cannot read properties of null')
      ) {
        console.warn('[Unhandled Promise] Navigation error suppressed:', event.reason.message)
        event.preventDefault()
        return
      }
    })
  }

  nuxtApp.hook('vue:error', (err: unknown) => {
    const errorLike = (typeof err === 'object' && err !== null) ? err as { message?: string } : null
    if (
      errorLike?.message?.includes('parentNode')
      || errorLike?.message?.includes('Cannot read properties of null')
    ) {
      console.warn('[Vue Hook Error] Navigation error suppressed:', errorLike?.message)
      return
    }
  })
})
