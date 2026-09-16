export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.config.errorHandler = (err: any, instance, info) => {
    if (
      err?.message?.includes('parentNode')
      || err?.message?.includes('Cannot read properties of null')
      || err?.message?.includes('reading \'parentNode\'')
    ) {
      console.warn('[Global Error Handler] Navigation error suppressed:', err.message)
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

  nuxtApp.hook('vue:error', (err: any) => {
    if (
      err?.message?.includes('parentNode')
      || err?.message?.includes('Cannot read properties of null')
    ) {
      console.warn('[Vue Hook Error] Navigation error suppressed:', err.message)
      return
    }
  })
})
