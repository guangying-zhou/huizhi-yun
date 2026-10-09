function activeRoleAppCode(value: unknown) {
  return String(value || '').trim() || 'app'
}

export const ACTIVE_ENTERPRISE_ROLE_COOKIE = 'hzy_active_enterprise_role'

export function activeRoleCookieName(_appCode?: string) {
  return ACTIVE_ENTERPRISE_ROLE_COOKIE
}

export function useActiveRole() {
  const pub = (useRuntimeConfig().public || {}) as Record<string, unknown>
  const appCode = activeRoleAppCode(pub.appCode || pub.appName)
  const { cookieOptions } = useCookieOptions()
  const activeRoleCode = useCookie<string | null | undefined>(activeRoleCookieName(appCode), cookieOptions())

  function setActiveRoleCode(roleCode: string | null | undefined) {
    activeRoleCode.value = String(roleCode || '').trim() || null
  }

  return {
    appCode,
    activeRoleCode,
    setActiveRoleCode
  }
}
