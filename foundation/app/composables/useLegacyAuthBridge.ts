import type { RouteLocationNormalized } from 'vue-router'

type AuthQueryOptions = {
  appName?: string
  redirectUrl: string
}

function isLoggedOutRoute(to: RouteLocationNormalized) {
  return to.path === '/login' && (to.query.logged_out === '1' || to.query.state === 'logged_out')
}

export function useLegacyAuthBridge() {
  const userProjectsCachePrefix = 'account:user-projects:'
  const config = useRuntimeConfig()
  const { casEnable, casBaseUrl, appName, accountUrl } = (config.public || {}) as {
    casEnable?: boolean
    casBaseUrl?: string
    appName?: string
    appCode?: string
    accountUrl?: string
  }
  const appCode = String((config.public || {}).appCode || appName || '').trim()

  const authState = useAuthState()

  function clearLegacyClientState(currentUser: string) {
    if (!import.meta.client || !currentUser) {
      return
    }

    try {
      localStorage.removeItem(`auth_user_departments:${currentUser}`)
      const keysToRemove: string[] = []
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index)
        if (key?.startsWith(userProjectsCachePrefix) && key.endsWith(`:${currentUser}`)) {
          keysToRemove.push(key)
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key))
    } catch {
      // 忽略 localStorage 清理失败，不阻断流程
    }
  }

  function clearLegacyAuthCookies() {
    authState.token.value = null
    authState.user.value = null
    authState.userEmail.value = null
    authState.userRole.value = null
    authState.userRealname.value = null
    authState.userNickname.value = null
    authState.userAvatar.value = null
    authState.userDepartment.value = null
    authState.userDeptCode.value = null
    authState.userMobileTail4.value = null
  }

  function buildLegacyAuthQuery(options: AuthQueryOptions) {
    const query = new URLSearchParams()
    query.set('target_app', String(options.appName || appName || 'app'))
    query.set('redirect', options.redirectUrl)
    return query
  }

  function resolveRedirectUrl(to: RouteLocationNormalized) {
    return useAppUrls().resolveCurrentAppUrl(to.fullPath)
  }

  async function logout() {
    const currentUser = String(authState.user.value || '').trim()
    clearLegacyAuthCookies()
    clearLegacyClientState(currentUser)

    useCookie('wecom_checked', { maxAge: 300 }).value = '1'

    if (appCode === 'console') {
      await $fetch('/api/v1/console/auth/logout', { method: 'POST' }).catch(() => null)
    }

    const loggedOutPath = '/login?logged_out=1'

    if (!casEnable) {
      return navigateTo(loggedOutPath)
    }

    const loginUrl = useAppUrls().resolveCurrentAppUrl(loggedOutPath)
    const url = `${String(casBaseUrl).replace(/\/$/, '')}/cas/logout?service=${encodeURIComponent(loginUrl)}`
    return navigateTo(url, { external: true })
  }

  async function handleRouteAccess(to: RouteLocationNormalized) {
    if (to.path.startsWith('/api/')) {
      return
    }

    if (isLoggedOutRoute(to)) {
      clearLegacyAuthCookies()
      return
    }

    if (authState.authenticated.value) {
      return
    }

    const isAccountApp = String(appName || '').trim() === 'account'
    if (isAccountApp && to.path === '/login') {
      return
    }

    if (!casEnable && isAccountApp) {
      return navigateTo('/login')
    }

    const redirectUrl = resolveRedirectUrl(to)
    const authQuery = buildLegacyAuthQuery({ redirectUrl })

    if (import.meta.client) {
      const isWeWork = /wxwork/i.test(navigator.userAgent)
      if (isWeWork) {
        const wecomChecked = useCookie<string | null | undefined>('wecom_checked')
        if (!wecomChecked.value) {
          if (isAccountApp) {
            window.location.assign(useAppUrls().resolveCurrentAppUrl(`/api/auth/wecom-login?${authQuery.toString()}`))
          } else {
            const entryBase = String(accountUrl || '').trim() || 'http://localhost:3000'
            window.location.assign(`${entryBase.replace(/\/$/, '')}/api/auth/wecom-login?${authQuery.toString()}`)
          }
          return
        }
      }
    }

    if (isAccountApp) {
      return navigateTo(`/login?${authQuery.toString()}`, { replace: true })
    }

    const entryBase = String(accountUrl || '').trim() || 'http://localhost:3000'
    return navigateTo(`${entryBase.replace(/\/$/, '')}/login?${authQuery.toString()}`, { external: true })
  }

  return {
    ...authState,
    buildLegacyAuthQuery,
    clearLegacyAuthCookies,
    clearLegacyClientState,
    handleRouteAccess,
    logout
  }
}
