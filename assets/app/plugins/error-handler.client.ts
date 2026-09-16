function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || '')
  }
  return ''
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.config.errorHandler = (err: unknown, _instance, info) => {
    const message = getErrorMessage(err)
    if (
      message.includes('parentNode')
      || message.includes('Cannot read properties of null')
      || message.includes('reading \'parentNode\'')
    ) {
      console.warn('[Global Error Handler] Navigation error suppressed:', message)
      return
    }
    console.error('[Global Error Handler]', err, info)
  }

  if (import.meta.client) {
    window.addEventListener('unhandledrejection', (event) => {
      const message = getErrorMessage(event.reason)
      if (
        message.includes('parentNode')
        || message.includes('Cannot read properties of null')
      ) {
        console.warn('[Unhandled Promise] Navigation error suppressed:', message)
        event.preventDefault()
        return
      }
    })
  }

  nuxtApp.hook('vue:error', (err: unknown) => {
    const message = getErrorMessage(err)
    if (
      message.includes('parentNode')
      || message.includes('Cannot read properties of null')
    ) {
      console.warn('[Vue Hook Error] Navigation error suppressed:', message)
      return
    }
  })
})
