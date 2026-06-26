type PlatformAuthAccount = {
  uid: string
  username: string
  email: string
  displayName: string
  accountType: string
}

type PlatformAuthSession = {
  sessionUuid: string
  scope: string
  tenantCode: string | null
  expiresAt: string
}

type PlatformAuthScope = 'admin' | 'dashboard'

type PlatformMePayload = {
  authenticated: boolean
  account: PlatformAuthAccount | null
  session: PlatformAuthSession | null
}

type DevWechatLoginPayload = {
  uid?: string
  displayName?: string
  phone?: string
  redirect?: string
}

type DevWechatLoginResponse = {
  account: PlatformAuthAccount
  session: {
    sessionUuid: string
    scope: string
  }
  redirect: string
}

type EmailAuthPayload = {
  email: string
  password: string
  displayName?: string
  redirect?: string
}

type EmailLoginPayload = {
  email: string
  password: string
  redirect?: string
}

type ResendActivationPayload = {
  email: string
  redirect?: string
}

type RegisterResponse = {
  account: PlatformAuthAccount
  activationEmailSent: boolean
  redirect: string
}

type EmailLoginResponse = {
  account: PlatformAuthAccount
  session: {
    sessionUuid: string
    scope: string
  }
  redirect: string
}

type ResendActivationResponse = {
  activationEmailSent: boolean
  redirect: string
}

type ApiResponse<T> = {
  success: boolean
  data: T
}

const legacyAuthCookieNames = [
  'auth_user',
  'token',
  'auth_email',
  'auth_role',
  'auth_realname',
  'auth_nickname',
  'auth_avatar',
  'auth_department',
  'auth_dept_code',
  'auth_mobile_tail4'
]

function normalizeString(value: unknown) {
  return String(value || '').trim()
}

function normalizeAuthScope(value: unknown, fallback: PlatformAuthScope = 'dashboard'): PlatformAuthScope {
  return value === 'admin' || value === 'platform_admin' ? 'admin' : fallback
}

function scopeFromPath(path: string): PlatformAuthScope {
  return path.startsWith('/admin') ? 'admin' : 'dashboard'
}

function resolveAuthScope(scope?: PlatformAuthScope) {
  if (scope) {
    return normalizeAuthScope(scope)
  }

  return scopeFromPath(useRoute().path)
}

function parseSessionTime(value: string) {
  const normalized = normalizeString(value)
  if (!normalized) {
    return 0
  }

  return Date.parse(normalized.includes('T') ? normalized : `${normalized.replace(' ', 'T')}Z`)
}

function isSessionFresh(currentSession: PlatformAuthSession | null) {
  if (!currentSession?.expiresAt) {
    return false
  }

  return parseSessionTime(currentSession.expiresAt) > Date.now() + 30_000
}

function clearLegacyAuthCookies() {
  for (const name of legacyAuthCookieNames) {
    useCookie<string | null | undefined>(name, {
      path: '/',
      sameSite: 'lax'
    }).value = null
  }
}

export function useAuth() {
  const account = useState<PlatformAuthAccount | null>('platform-auth-account', () => null)
  const session = useState<PlatformAuthSession | null>('platform-auth-session', () => null)
  const loaded = useState<boolean>('platform-auth-loaded', () => false)
  const loadedScope = useState<PlatformAuthScope | ''>('platform-auth-loaded-scope', () => '')
  const loading = useState<boolean>('platform-auth-loading', () => false)

  const authenticated = computed(() => Boolean(account.value && session.value))
  const user = computed(() => account.value?.uid || '')
  const token = computed(() => session.value?.sessionUuid || '')
  const userEmail = computed(() => account.value?.email || '')
  const userRole = computed(() => account.value?.accountType || '')
  const userRealname = computed(() => account.value?.displayName || account.value?.username || '')
  const userNickname = computed(() => account.value?.displayName || '')
  const userAvatar = computed(() => '')
  const userDepartment = computed(() => '')
  const userDeptCode = computed(() => '')
  const userMobileTail4 = computed(() => '')

  function clearAuthState() {
    account.value = null
    session.value = null
    loadedScope.value = ''
  }

  function clearAuthCookies() {
    clearAuthState()
    clearLegacyAuthCookies()
    loaded.value = true
  }

  async function loadMe(options: { force?: boolean, scope?: PlatformAuthScope } = {}) {
    const scope = resolveAuthScope(options.scope)

    if (loaded.value && loadedScope.value === scope && !options.force && (!session.value || isSessionFresh(session.value))) {
      return {
        account: account.value,
        session: session.value,
        authenticated: authenticated.value
      }
    }

    loading.value = true

    try {
      const response = await platformFetchJson<ApiResponse<PlatformMePayload>>('/api/platform/auth/me', {
        query: {
          scope
        }
      })
      const payload = response.data

      if (payload.authenticated && payload.account && payload.session) {
        account.value = payload.account
        session.value = payload.session
        loadedScope.value = scope
      } else {
        clearAuthState()
      }
    } catch {
      clearAuthState()
    } finally {
      loaded.value = true
      loading.value = false
    }

    return {
      account: account.value,
      session: session.value,
      authenticated: authenticated.value
    }
  }

  async function loginWithDevWechat(payload: DevWechatLoginPayload = {}) {
    const response = await platformFetchJson<ApiResponse<DevWechatLoginResponse>>('/api/platform/auth/dev-wechat-login', {
      method: 'POST',
      body: {
        ...payload,
        redirect: normalizeString(payload.redirect) || undefined
      }
    })

    await loadMe({ force: true, scope: 'admin' })
    return response.data
  }

  async function registerWithEmail(payload: EmailAuthPayload) {
    const response = await platformFetchJson<ApiResponse<RegisterResponse>>('/api/platform/auth/register', {
      method: 'POST',
      body: {
        email: normalizeString(payload.email),
        password: payload.password,
        displayName: normalizeString(payload.displayName) || undefined,
        redirect: normalizeString(payload.redirect) || undefined
      }
    })

    return response.data
  }

  async function loginWithEmail(payload: EmailLoginPayload) {
    const response = await platformFetchJson<ApiResponse<EmailLoginResponse>>('/api/platform/auth/login', {
      method: 'POST',
      body: {
        email: normalizeString(payload.email),
        password: payload.password,
        redirect: normalizeString(payload.redirect) || undefined
      }
    })

    await loadMe({ force: true, scope: 'dashboard' })
    return response.data
  }

  async function resendActivationEmail(payload: ResendActivationPayload) {
    const response = await platformFetchJson<ApiResponse<ResendActivationResponse>>('/api/platform/auth/resend-activation', {
      method: 'POST',
      body: {
        email: normalizeString(payload.email),
        redirect: normalizeString(payload.redirect) || undefined
      }
    })

    return response.data
  }

  async function logout(options: { scope?: PlatformAuthScope, redirect?: string } = {}) {
    const scope = resolveAuthScope(options.scope)
    try {
      await $fetch('/api/platform/auth/logout', {
        method: 'POST',
        body: {
          scope
        }
      })
    } finally {
      clearAuthCookies()
    }

    return navigateTo(options.redirect || (scope === 'admin' ? '/admin/login' : '/dashboard/login'))
  }

  return {
    authenticated,
    loading,
    loaded,
    account,
    session,
    user,
    token,
    userEmail,
    userRole,
    userRealname,
    userNickname,
    userAvatar,
    userDepartment,
    userDeptCode,
    userMobileTail4,
    loadMe,
    loginWithDevWechat,
    registerWithEmail,
    loginWithEmail,
    resendActivationEmail,
    clearAuthCookies,
    logout
  }
}
