import type { RouteLocationNormalized } from 'vue-router'

type JwtClaims = {
  exp?: number
  sub?: string
  email?: string
  name?: string
  real_name?: string
  nickname?: string
  picture?: string
  tenant?: string
  deployment?: string
  policy_ver?: string
  hzy?: {
    uid?: string
    subjectCode?: string
  }
}

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=')

  if (import.meta.client) {
    return decodeURIComponent(escape(window.atob(padded)))
  }

  return Buffer.from(padded, 'base64').toString('utf8')
}

function decodeJwtClaims(token: string | null | undefined): JwtClaims | null {
  const value = String(token || '').trim()
  const [, payload] = value.split('.')
  if (!payload) {
    return null
  }

  try {
    return JSON.parse(base64UrlDecode(payload)) as JwtClaims
  } catch {
    return null
  }
}

function isTokenActive(claims: JwtClaims | null) {
  if (!claims) {
    return false
  }

  if (!claims.exp) {
    return true
  }

  return claims.exp > Math.floor(Date.now() / 1000) + 15
}

function resolveRedirectUrl(to: RouteLocationNormalized) {
  return useAppUrls().resolveCurrentAppUrl(to.fullPath)
}

function resolveDisplayName(claims: JwtClaims | null, uid: string) {
  return String(claims?.real_name || claims?.name || claims?.nickname || uid || '').trim()
}

function isLoggedOutRoute(to: RouteLocationNormalized) {
  return to.path === '/login' && (to.query.logged_out === '1' || to.query.state === 'logged_out')
}

function cookieScope(value: unknown) {
  return String(value || 'app')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'app'
}

function getOidcCookieNames(pub: Record<string, unknown>) {
  const scope = cookieScope(pub.appCode || pub.appName)
  return {
    accessToken: `hzy_${scope}_access_token`,
    idToken: `hzy_${scope}_id_token`,
    uid: `hzy_${scope}_uid`,
    tenant: `hzy_${scope}_tenant`,
    subjectCode: `hzy_${scope}_subject_code`,
    policyVersion: `hzy_${scope}_policy_ver`
  } as const
}

function readBrowserCookie(name: string) {
  if (!import.meta.client) return null

  const prefix = `${encodeURIComponent(name)}=`
  const value = document.cookie
    .split(';')
    .map(item => item.trim())
    .find(item => item.startsWith(prefix))
  return value ? decodeURIComponent(value.slice(prefix.length)) : null
}

export function useConsoleOidcAuth() {
  const config = useRuntimeConfig()
  const pub = (config.public || {}) as Record<string, unknown>
  const { resolveCurrentAppUrl } = useAppUrls()
  const authMode = String(pub.authMode || '').trim()
  const legacyAuthBridge = pub.legacyAuthBridge === true || String(pub.legacyAuthBridge || '').toLowerCase() === 'true'
  const consoleUrl = String(pub.consoleUrl || '').trim()
  const enabled = computed(() => Boolean(consoleUrl && authMode !== 'legacy' && !legacyAuthBridge))
  const { cookieOptions } = useCookieOptions()
  const opts = cookieOptions()
  const cookieNames = getOidcCookieNames(pub)

  const token = useCookie<string | null | undefined>(cookieNames.accessToken, opts)
  const idToken = useCookie<string | null | undefined>(cookieNames.idToken, opts)
  const userCookie = useCookie<string | null | undefined>(cookieNames.uid, opts)
  const tenantCookie = useCookie<string | null | undefined>(cookieNames.tenant, opts)
  const subjectCodeCookie = useCookie<string | null | undefined>(cookieNames.subjectCode, opts)
  const policyVersionCookie = useCookie<string | null | undefined>(cookieNames.policyVersion, opts)

  const legacyToken = useCookie<string | null | undefined>('hzy_access_token', opts)
  const legacyIdToken = useCookie<string | null | undefined>('hzy_id_token', opts)
  const legacyUserCookie = useCookie<string | null | undefined>('hzy_uid', opts)
  const legacyTenantCookie = useCookie<string | null | undefined>('hzy_tenant', opts)
  const legacySubjectCodeCookie = useCookie<string | null | undefined>('hzy_subject_code', opts)
  const legacyPolicyVersionCookie = useCookie<string | null | undefined>('hzy_policy_ver', opts)
  const serverValidatedTokenKey = useState<string>('console-oidc-server-validated-token', () => '')

  const claims = computed(() => decodeJwtClaims(token.value))
  const idClaims = computed(() => decodeJwtClaims(idToken.value))
  const user = computed(() => String(userCookie.value || claims.value?.hzy?.uid || claims.value?.sub?.replace(/^user:/, '') || '').trim())
  const userEmail = computed(() => String(idClaims.value?.email || claims.value?.email || '').trim() || null)
  const userRealname = computed(() => resolveDisplayName(idClaims.value || claims.value, user.value) || null)
  const userNickname = computed(() => String(idClaims.value?.nickname || claims.value?.nickname || user.value || '').trim() || null)
  const userAvatar = computed(() => String(idClaims.value?.picture || claims.value?.picture || '').trim() || null)
  const userRole = computed(() => null)
  const userDepartment = computed(() => null)
  const userDeptCode = computed(() => null)
  const userMobileTail4 = computed(() => null)
  const tenant = computed(() => String(tenantCookie.value || claims.value?.tenant || '').trim() || null)
  const subjectCode = computed(() => String(subjectCodeCookie.value || claims.value?.hzy?.subjectCode || '').trim() || null)
  const policyVersion = computed(() => String(policyVersionCookie.value || claims.value?.policy_ver || '').trim() || null)
  const authenticated = computed(() => Boolean(enabled.value && token.value && user.value && isTokenActive(claims.value)))

  function clearLocalOidcState() {
    token.value = null
    idToken.value = null
    userCookie.value = null
    tenantCookie.value = null
    subjectCodeCookie.value = null
    policyVersionCookie.value = null
    legacyToken.value = null
    legacyIdToken.value = null
    legacyUserCookie.value = null
    legacyTenantCookie.value = null
    legacySubjectCodeCookie.value = null
    legacyPolicyVersionCookie.value = null
  }

  function syncOidcCookiesFromBrowser() {
    if (!import.meta.client) return

    token.value = readBrowserCookie(cookieNames.accessToken)
    idToken.value = readBrowserCookie(cookieNames.idToken)
    userCookie.value = readBrowserCookie(cookieNames.uid)
    tenantCookie.value = readBrowserCookie(cookieNames.tenant)
    subjectCodeCookie.value = readBrowserCookie(cookieNames.subjectCode)
    policyVersionCookie.value = readBrowserCookie(cookieNames.policyVersion)
  }

  function currentTokenKey() {
    const current = String(token.value || '')
    if (!current) return ''
    return `${current.length}:${current.slice(0, 16)}:${current.slice(-16)}`
  }

  async function login(redirect?: string) {
    const target = redirect || (import.meta.client ? window.location.href : '/')
    const query = new URLSearchParams({ redirect: target })
    return navigateTo(resolveCurrentAppUrl(`/api/auth/oidc-login?${query.toString()}`), { external: true })
  }

  async function logout() {
    return navigateTo(resolveCurrentAppUrl('/api/auth/logout?state=logged_out'), { external: true })
  }

  async function refresh() {
    await $fetch(resolveCurrentAppUrl('/api/auth/refresh'), { method: 'POST' })
    syncOidcCookiesFromBrowser()
    serverValidatedTokenKey.value = ''
  }

  async function verifyServerSession() {
    if (!authenticated.value) {
      serverValidatedTokenKey.value = ''
      return false
    }

    const tokenKey = currentTokenKey()
    if (tokenKey && serverValidatedTokenKey.value === tokenKey) {
      return true
    }

    try {
      const response = await $fetch<{ authenticated?: boolean, uid?: string | null }>(
        resolveCurrentAppUrl('/api/auth/me'),
        { credentials: 'include' }
      )
      if (response?.authenticated && String(response.uid || '').trim()) {
        serverValidatedTokenKey.value = tokenKey
        return true
      }
    } catch {
      // Fall through to refresh/re-login in the route guard.
    }

    serverValidatedTokenKey.value = ''
    return false
  }

  async function recoverServerSession() {
    if (!token.value) {
      return false
    }

    try {
      await refresh()
      return await verifyServerSession()
    } catch {
      serverValidatedTokenKey.value = ''
      return false
    }
  }

  async function handleRouteAccess(to: RouteLocationNormalized) {
    if (to.path.startsWith('/api/')) {
      return
    }

    if (to.path === '/login') {
      if (isLoggedOutRoute(to)) {
        clearLocalOidcState()
      }
      return
    }

    if (authenticated.value && await verifyServerSession()) {
      return
    }

    if (authenticated.value) {
      if (await recoverServerSession()) {
        return
      }

      clearLocalOidcState()
      return login(resolveRedirectUrl(to))
    }

    if (token.value) {
      try {
        await refresh()
        if (await verifyServerSession()) {
          return
        }
      } catch {
        clearLocalOidcState()
        return navigateTo('/login?logged_out=1', { replace: true })
      }
    }

    return login(resolveRedirectUrl(to))
  }

  return {
    enabled,
    authenticated,
    token,
    idToken,
    user,
    userEmail,
    userRole,
    userRealname,
    userNickname,
    userAvatar,
    userDepartment,
    userDeptCode,
    userMobileTail4,
    tenant,
    subjectCode,
    policyVersion,
    claims,
    handleRouteAccess,
    login,
    logout,
    refresh,
    verifyServerSession
  }
}
