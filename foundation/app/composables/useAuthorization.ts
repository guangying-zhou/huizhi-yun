import { createAuthorizationState } from '@hzy/platform-adapter-nuxt'

/**
 * 统一授权快照 composable。
 * 当前阶段仍从旧 `/api/auth/permissions` 读取，再在 Foundation 内部归一化；
 * 后续切到 platform-adapter-nuxt 时，只需要替换这里的数据来源。
 */

type LegacyAuthorizationSnapshot = {
  uid: string
  roles: string[]
  availableRoles: AuthorizationRoleOption[]
  activeRoleCode: string
  resources: Record<string, string[]>
  actionPolicies: Record<string, { implications: Record<string, string[]> }>
}

type LoadAuthorizationOptions = {
  force?: boolean
}

export type AuthorizationRoleOption = {
  roleCode: string
  roleName: string
  roleType: string
  appCode: string | null
  sources?: string[]
}

const emptyAuthorization: LegacyAuthorizationSnapshot = {
  uid: '',
  roles: [],
  availableRoles: [],
  activeRoleCode: '',
  resources: {},
  actionPolicies: {}
}
const sparseRetryDelayMs = 1200
const maxSparseRetryAttempts = 5

function fetchStatusCode(error: unknown) {
  const record = error as {
    status?: number
    statusCode?: number
    response?: { status?: number, statusCode?: number }
  } | null | undefined

  return Number(record?.statusCode || record?.status || record?.response?.statusCode || record?.response?.status || 0)
}

function isEnterpriseRoleOption(role: AuthorizationRoleOption) {
  const roleCode = String(role.roleCode || '').trim()
  if (!roleCode || roleCode.includes(':') || roleCode.includes('.')) return false
  return !String(role.appCode || '').trim()
}

async function fetchAuthorizationSnapshot() {
  type AuthorizationSnapshotResponse = {
    code: number
    data: {
      uid: string
      roles: string[]
      availableRoles?: AuthorizationRoleOption[]
      activeRoleCode?: string | null
      resources: Record<string, string[]>
      actionPolicies?: Record<string, { implications: Record<string, string[]> }>
    }
  }
  type AuthorizationFetch = (url: string) => Promise<AuthorizationSnapshotResponse>
  let requestFetch: AuthorizationFetch
  if (import.meta.server) {
    const serverFetch: unknown = useRequestFetch()
    requestFetch = serverFetch as AuthorizationFetch
  } else {
    const clientFetch: unknown = $fetch
    requestFetch = clientFetch as AuthorizationFetch
  }
  const response = await requestFetch('/api/auth/permissions')

  if (response.code === 0 && response.data) {
    const availableRoles = (response.data.availableRoles || []).map(role => ({
      roleCode: String(role.roleCode || '').trim(),
      roleName: String(role.roleName || role.roleCode || '').trim(),
      roleType: String(role.roleType || '').trim(),
      appCode: role.appCode ? String(role.appCode).trim() : null,
      sources: Array.isArray(role.sources) ? role.sources.map(source => String(source || '').trim()).filter(Boolean) : []
    })).filter(role => role.roleCode && isEnterpriseRoleOption(role))
    const responseActive = String(response.data.activeRoleCode || response.data.roles?.[0] || '').trim()
    const active = availableRoles.some(role => role.roleCode === responseActive)
      ? responseActive
      : availableRoles[0]?.roleCode || ''

    return {
      uid: response.data.uid || '',
      roles: response.data.roles || [],
      availableRoles,
      activeRoleCode: active,
      resources: response.data.resources || {},
      actionPolicies: response.data.actionPolicies || {}
    }
  }

  return emptyAuthorization
}

async function fetchAuthorizationSnapshotWithRefresh() {
  try {
    return await fetchAuthorizationSnapshot()
  } catch (error) {
    if (import.meta.client && fetchStatusCode(error) === 401) {
      const auth = useAuth()
      if ('refresh' in auth && typeof auth.refresh === 'function') {
        await auth.refresh()
        return await fetchAuthorizationSnapshot()
      }
    }

    throw error
  }
}

const authorizationState = createAuthorizationState<LegacyAuthorizationSnapshot>(async () => {
  return await fetchAuthorizationSnapshotWithRefresh()
})
const sparseRetryAttempts = ref(0)
let sparseRetryTimer: ReturnType<typeof setTimeout> | null = null
let lastAuthFingerprint = ''
let forcedLoadGeneration = 0
let authWatcherInstalled = false

function hasAnyResource(snapshot: LegacyAuthorizationSnapshot | null | undefined) {
  return Object.values(snapshot?.resources || {}).some(actions => Array.isArray(actions) && actions.length > 0)
}

function authFingerprint() {
  if (!import.meta.client) return ''
  const auth = useAuth()
  return [
    auth.authenticated.value ? '1' : '0',
    String(auth.user.value || ''),
    String(auth.tenant.value || ''),
    String(auth.policyVersion.value || '')
  ].join('|')
}

function clearSparseRetry() {
  if (!sparseRetryTimer) return
  clearTimeout(sparseRetryTimer)
  sparseRetryTimer = null
}

function shouldRetrySparseAuthorization(snapshot: LegacyAuthorizationSnapshot | null | undefined) {
  if (!import.meta.client) return false
  const auth = useAuth()
  return Boolean(auth.authenticated.value && snapshot?.uid && !hasAnyResource(snapshot))
}

function scheduleSparseRetry(retry: () => unknown | Promise<unknown>) {
  if (!import.meta.client || sparseRetryAttempts.value >= maxSparseRetryAttempts) return

  clearSparseRetry()
  sparseRetryAttempts.value += 1
  sparseRetryTimer = setTimeout(() => {
    sparseRetryTimer = null
    authorizationState.clear()
    void retry()
  }, sparseRetryDelayMs * sparseRetryAttempts.value)
}

function settleSparseRetry(snapshot: LegacyAuthorizationSnapshot | null | undefined, retry: () => unknown | Promise<unknown>) {
  if (shouldRetrySparseAuthorization(snapshot)) {
    scheduleSparseRetry(retry)
    return
  }

  clearSparseRetry()
  sparseRetryAttempts.value = 0
}

export function useAuthorization() {
  async function loadAuthorization(options: LoadAuthorizationOptions = {}) {
    const fingerprint = authFingerprint()
    if (fingerprint && fingerprint !== lastAuthFingerprint) {
      clearSparseRetry()
      sparseRetryAttempts.value = 0
      lastAuthFingerprint = fingerprint
    }

    if (options.force) {
      const generation = forcedLoadGeneration + 1
      forcedLoadGeneration = generation
      authorizationState.clear()
      authorizationState.loading.value = true
      authorizationState.error.value = null

      try {
        const snapshot = await fetchAuthorizationSnapshotWithRefresh() || emptyAuthorization

        if (generation === forcedLoadGeneration) {
          authorizationState.snapshot.value = snapshot
          authorizationState.loaded.value = true
          authorizationState.loading.value = false
          authorizationState.error.value = null
        }

        settleSparseRetry(snapshot, () => loadAuthorization({ force: true }))
        return snapshot
      } catch (error) {
        console.error('[Authorization] Failed to load:', error)

        if (generation === forcedLoadGeneration) {
          authorizationState.snapshot.value = emptyAuthorization
          authorizationState.error.value = error
          authorizationState.loaded.value = true
          authorizationState.loading.value = false
        }

        scheduleSparseRetry(() => loadAuthorization({ force: true }))
        return emptyAuthorization
      }
    }

    try {
      const snapshot = await authorizationState.load() || emptyAuthorization

      settleSparseRetry(snapshot, loadAuthorization)

      return snapshot
    } catch (error) {
      console.error('[Authorization] Failed to load:', error)
      authorizationState.snapshot.value = emptyAuthorization
      authorizationState.error.value = error
      authorizationState.loaded.value = true
      authorizationState.loading.value = false
      scheduleSparseRetry(loadAuthorization)
      return emptyAuthorization
    }
  }

  function getAuthorization() {
    return authorizationState.snapshot.value
  }

  function clearAuthorizationCache() {
    authorizationState.clear()
  }

  if (import.meta.client && !authWatcherInstalled) {
    authWatcherInstalled = true
    watch(authFingerprint, (fingerprint, previousFingerprint) => {
      if (!fingerprint.startsWith('1|') || fingerprint === previousFingerprint) return
      void loadAuthorization({ force: true })
    }, { flush: 'post' })
  }

  return {
    loadAuthorization,
    getAuthorization,
    clearAuthorizationCache,
    loaded: authorizationState.loaded,
    loading: authorizationState.loading,
    error: authorizationState.error
  }
}
