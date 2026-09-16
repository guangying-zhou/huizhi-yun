import { createAuthorizationState, type AuthorizationState } from '@hzy/platform-adapter-nuxt'
import type { Ref } from 'vue'
import { createScopedRuntimeRegistry } from '~/utils/scopedRuntimeRegistry'

type LegacyAuthorizationSnapshot = {
  uid: string
  roles: string[]
  availableRoles: AuthorizationRoleOption[]
  activeRoleCode: string
  resources: Record<string, string[]>
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
  resources: {}
}
const sparseRetryDelayMs = 1200
const maxSparseRetryAttempts = 5

type AuthorizationRuntime = {
  authorizationState: AuthorizationState<LegacyAuthorizationSnapshot>
  sparseRetryAttempts: Ref<number>
  sparseRetryTimer: ReturnType<typeof setTimeout> | null
  lastAuthFingerprint: string
  forcedLoadGeneration: number
  authWatcherInstalled: boolean
}

function fetchStatusCode(error: unknown) {
  const record = error as {
    status?: number
    statusCode?: number
    response?: { status?: number, statusCode?: number }
  } | null | undefined

  return Number(record?.statusCode || record?.status || record?.response?.statusCode || record?.response?.status || 0)
}

function withAppBase(path: string) {
  const config = useRuntimeConfig()
  const base = String(config.public.appBasePath || config.app.baseURL || '/')
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return `${normalizedBase}${normalizedPath}`.replace(/\/{2,}/g, '/')
}

function isEnterpriseRoleOption(role: AuthorizationRoleOption) {
  const roleCode = String(role.roleCode || '').trim()
  if (!roleCode || roleCode.includes(':') || roleCode.includes('.')) return false
  return !String(role.appCode || '').trim()
}

async function fetchAuthorizationSnapshot() {
  const response = await $fetch<{
    code: number
    data: {
      uid: string
      roles: string[]
      availableRoles?: AuthorizationRoleOption[]
      activeRoleCode?: string | null
      resources: Record<string, string[]>
    }
  }>(withAppBase('/api/auth/permissions'))

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
      resources: response.data.resources || {}
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

const authorizationRuntimeFor = createScopedRuntimeRegistry<object, AuthorizationRuntime>(() => ({
  authorizationState: createAuthorizationState<LegacyAuthorizationSnapshot>(async () => {
    return await fetchAuthorizationSnapshotWithRefresh()
  }),
  sparseRetryAttempts: ref(0),
  sparseRetryTimer: null,
  lastAuthFingerprint: '',
  forcedLoadGeneration: 0,
  authWatcherInstalled: false
}))

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

function clearSparseRetry(runtime: AuthorizationRuntime) {
  if (!runtime.sparseRetryTimer) return
  clearTimeout(runtime.sparseRetryTimer)
  runtime.sparseRetryTimer = null
}

function shouldRetrySparseAuthorization(snapshot: LegacyAuthorizationSnapshot | null | undefined) {
  if (!import.meta.client) return false
  const auth = useAuth()
  return Boolean(auth.authenticated.value && snapshot?.uid && !hasAnyResource(snapshot))
}

function scheduleSparseRetry(runtime: AuthorizationRuntime, retry: () => unknown | Promise<unknown>) {
  if (!import.meta.client || runtime.sparseRetryAttempts.value >= maxSparseRetryAttempts) return

  clearSparseRetry(runtime)
  runtime.sparseRetryAttempts.value += 1
  runtime.sparseRetryTimer = setTimeout(() => {
    runtime.sparseRetryTimer = null
    runtime.authorizationState.clear()
    void retry()
  }, sparseRetryDelayMs * runtime.sparseRetryAttempts.value)
}

function settleSparseRetry(runtime: AuthorizationRuntime, snapshot: LegacyAuthorizationSnapshot | null | undefined, retry: () => unknown | Promise<unknown>) {
  if (shouldRetrySparseAuthorization(snapshot)) {
    scheduleSparseRetry(runtime, retry)
    return
  }

  clearSparseRetry(runtime)
  runtime.sparseRetryAttempts.value = 0
}

export function useAuthorization() {
  const runtime = authorizationRuntimeFor(useNuxtApp())
  const authorizationState = runtime.authorizationState

  async function loadAuthorization(options: LoadAuthorizationOptions = {}) {
    const fingerprint = authFingerprint()
    if (fingerprint && fingerprint !== runtime.lastAuthFingerprint) {
      clearSparseRetry(runtime)
      runtime.sparseRetryAttempts.value = 0
      runtime.lastAuthFingerprint = fingerprint
    }

    if (options.force) {
      const generation = runtime.forcedLoadGeneration + 1
      runtime.forcedLoadGeneration = generation
      authorizationState.clear()
      authorizationState.loading.value = true
      authorizationState.error.value = null

      try {
        const snapshot = await fetchAuthorizationSnapshotWithRefresh() || emptyAuthorization

        if (generation === runtime.forcedLoadGeneration) {
          authorizationState.snapshot.value = snapshot
          authorizationState.loaded.value = true
          authorizationState.loading.value = false
          authorizationState.error.value = null
        }

        settleSparseRetry(runtime, snapshot, () => loadAuthorization({ force: true }))
        return snapshot
      } catch (error) {
        console.error('[Finance Authorization] Failed to load:', error)

        if (generation === runtime.forcedLoadGeneration) {
          authorizationState.snapshot.value = emptyAuthorization
          authorizationState.error.value = error
          authorizationState.loaded.value = true
          authorizationState.loading.value = false
        }

        scheduleSparseRetry(runtime, () => loadAuthorization({ force: true }))
        return emptyAuthorization
      }
    }

    try {
      const snapshot = await authorizationState.load() || emptyAuthorization

      settleSparseRetry(runtime, snapshot, loadAuthorization)

      return snapshot
    } catch (error) {
      console.error('[Finance Authorization] Failed to load:', error)
      authorizationState.snapshot.value = emptyAuthorization
      authorizationState.error.value = error
      authorizationState.loaded.value = true
      authorizationState.loading.value = false
      scheduleSparseRetry(runtime, loadAuthorization)
      return emptyAuthorization
    }
  }

  function getAuthorization() {
    return authorizationState.snapshot.value
  }

  function clearAuthorizationCache() {
    authorizationState.clear()
  }

  if (import.meta.client && !runtime.authWatcherInstalled) {
    runtime.authWatcherInstalled = true
    watch(authFingerprint, (fingerprint, previousFingerprint) => {
      if (!fingerprint.startsWith('1|') || fingerprint === previousFingerprint) return
      void loadAuthorization({ force: true })
    }, { flush: 'post', immediate: true })
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
