export default defineNuxtRouteMiddleware((to) => {
  // Skip API routes
  if (to.path.startsWith('/api/')) {
    return
  }

  const config = useRuntimeConfig()
  const { casEnable, accountUrl, appName } = (config.public || {}) as {
    casEnable?: boolean
    accountUrl?: string
    appName?: string
  }

  const token = useCookie('token')
  const authUser = useCookie('auth_user')
  if (token.value && authUser.value) {
    return
  }

  if (!casEnable) {
    if (to.path === '/login') return
    return navigateTo('/login', { replace: true })
  }

  const redirectUrl = import.meta.client
    ? `${window.location.origin}${to.fullPath}`
    : (() => {
        const headers = useRequestHeaders(['host', 'x-forwarded-proto'])
        const proto = String(headers['x-forwarded-proto'] || 'http').split(',')[0] || 'http'
        const host = headers.host || 'localhost:3000'
        return `${proto}://${host}${to.fullPath}`
      })()
  const query = new URLSearchParams({
    target_app: String(appName || 'insights'),
    redirect: redirectUrl
  })
  const accountBase = String(accountUrl || '').trim() || 'http://localhost:3000'

  return navigateTo(`${accountBase.replace(/\/$/, '')}/login?${query.toString()}`, { external: true })
})
