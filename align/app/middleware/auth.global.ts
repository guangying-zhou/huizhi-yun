export default defineNuxtRouteMiddleware((to) => {
  if (to.path.startsWith('/api/')) {
    return
  }

  const { cookieOptions } = useCookieOptions()
  const opts = cookieOptions()
  const config = useRuntimeConfig()
  const { appCode, casEnable, accountUrl } = (config.public || {}) as {
    appCode?: string
    casEnable?: boolean
    accountUrl?: string
  }

  const token = useCookie<string | null | undefined>('token', opts)
  const authUser = useCookie<string | null | undefined>('auth_user', opts)
  const tokenValue = String(token?.value || '').trim()
  const userValue = String(authUser?.value || '').trim()

  if (tokenValue && tokenValue !== 'null' && tokenValue !== 'undefined' && userValue) {
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

  const authQuery = new URLSearchParams({
    target_app: String(appCode || 'align'),
    redirect: redirectUrl
  })
  const accountBase = String(accountUrl || '').trim() || 'http://localhost:3000'

  if (import.meta.client) {
    const isWeWork = /wxwork/i.test(navigator.userAgent)
    if (isWeWork) {
      const wecomChecked = useCookie<string | null | undefined>('wecom_checked')
      if (!wecomChecked.value) {
        window.location.assign(`${accountBase.replace(/\/$/, '')}/api/auth/wecom-login?${authQuery.toString()}`)
        return
      }
    }
  }

  return navigateTo(`${accountBase.replace(/\/$/, '')}/login?${authQuery.toString()}`, { external: true })
})
