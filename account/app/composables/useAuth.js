export function useAuth() {
  const config = useRuntimeConfig()
  const { casEnable, casBaseUrl } = config.public || {}

  // 获取跨域 Cookie 配置（SSO）
  const { cookieOptions } = useCookieOptions()
  const opts = cookieOptions()

  // Ensure cookies are bound with root path so set/clear works consistently
  const user = useCookie('auth_user', opts)
  const token = useCookie('token', opts)

  function logout() {
    // Clear all auth cookies
    token.value = null
    user.value = null
    useCookie('auth_email', opts).value = null
    useCookie('auth_id', opts).value = null
    useCookie('auth_role', opts).value = null
    useCookie('auth_realname', opts).value = null
    useCookie('auth_nickname', opts).value = null
    useCookie('auth_avatar', opts).value = null
    useCookie('auth_department', opts).value = null
    useCookie('auth_dept_code', opts).value = null

    // 阻止企业微信自动重新登录
    useCookie('wecom_checked', { maxAge: 300 }).value = '1'

    if (!casEnable) {
      return navigateTo('/login')
    }

    // CAS logout 并重定向回登录页面
    const loginUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/login`
      : '/login'
    const url = `${String(casBaseUrl).replace(/\/$/, '')}/cas/logout?service=${encodeURIComponent(loginUrl)}`
    return navigateTo(url, { external: true })
  }

  return { user, token, logout }
}
