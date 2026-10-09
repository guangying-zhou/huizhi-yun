import { effectScope, getCurrentInstance, inject } from 'vue'
import { authorizationModuleScope } from '../utils/authorizationModuleScope'
import { createAuthorizationState } from '@hzy/platform-adapter-nuxt'
import {
  isEnterpriseHostAuthorization,
  parseAuthorizationSnapshotResponse,
  resolveAuthorizationSnapshotSource,
  type AuthorizationSnapshotSource
} from '../../shared/utils/authorizationSnapshotSource'

/**
 * 统一授权快照 composable。
 * 独立应用从本应用 `/api/auth/permissions` 读取；企业宿主按当前页面所属模块
 * （构建期路由 meta `authorizationApp`）读取 `/enterprise/api/auth/permissions?app=`，
 * 每个模块独立缓存，不合并不同模块的同名资源。
 * 响应不是预期 JSON 信封时视为加载失败（error），不会静默当作空快照。
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

async function fetchAuthorizationSnapshot(source: AuthorizationSnapshotSource): Promise<LegacyAuthorizationSnapshot> {
  type AuthorizationFetch = (url: string) => Promise<unknown>
  let requestFetch: AuthorizationFetch
  if (import.meta.server) {
    const serverFetch: unknown = useRequestFetch()
    requestFetch = serverFetch as AuthorizationFetch
  } else {
    const clientFetch: unknown = $fetch
    requestFetch = clientFetch as AuthorizationFetch
  }
  const response = await requestFetch(source.url)
  return parseAuthorizationSnapshotResponse(response, source.expectedApp)
}

async function fetchAuthorizationSnapshotWithRefresh(source: AuthorizationSnapshotSource) {
  try {
    try {
      return await fetchAuthorizationSnapshot(source)
    } catch (error) {
      if (import.meta.client && fetchStatusCode(error) === 401) {
        const auth = useAuth()
        if ('refresh' in auth && typeof auth.refresh === 'function') {
          await auth.refresh()
          return await fetchAuthorizationSnapshot(source)
        }
      }

      throw error
    }
  } catch (error) {
    // Fail closed but loudly: callers see `error` and an empty snapshot.
    console.error(`[Authorization] 权限信息加载失败 (${source.expectedApp || 'app'}):`, error)
    throw error
  }
}

type AuthorizationScope = {
  source: AuthorizationSnapshotSource
  state: ReturnType<typeof createAuthorizationState<LegacyAuthorizationSnapshot>>
  sparseRetryAttempts: number
  sparseRetryTimer: ReturnType<typeof setTimeout> | null
  forcedLoadGeneration: number
}

// One cached state per snapshot source: '' for a standalone application, the
// owning module code for Enterprise Host pages. Modules never share a state.
const scopes = new Map<string, AuthorizationScope>()
let lastAuthFingerprint = ''
let authWatcherInstalled = false

function scopeFor(source: AuthorizationSnapshotSource) {
  let scope = scopes.get(source.key)
  if (!scope) {
    scope = {
      source,
      state: createAuthorizationState<LegacyAuthorizationSnapshot>(async () => await fetchAuthorizationSnapshotWithRefresh(source)),
      sparseRetryAttempts: 0,
      sparseRetryTimer: null,
      forcedLoadGeneration: 0
    }
    scopes.set(source.key, scope)
  }
  return scope
}

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

function clearSparseRetry(scope: AuthorizationScope) {
  if (!scope.sparseRetryTimer) return
  clearTimeout(scope.sparseRetryTimer)
  scope.sparseRetryTimer = null
}

function shouldRetrySparseAuthorization(snapshot: LegacyAuthorizationSnapshot | null | undefined) {
  if (!import.meta.client) return false
  const auth = useAuth()
  return Boolean(auth.authenticated.value && snapshot?.uid && !hasAnyResource(snapshot))
}

function scheduleSparseRetry(scope: AuthorizationScope) {
  if (!import.meta.client || scope.sparseRetryAttempts >= maxSparseRetryAttempts) return

  clearSparseRetry(scope)
  scope.sparseRetryAttempts += 1
  scope.sparseRetryTimer = setTimeout(() => {
    scope.sparseRetryTimer = null
    void loadScope(scope, { force: true })
  }, sparseRetryDelayMs * scope.sparseRetryAttempts)
}

function settleSparseRetry(scope: AuthorizationScope, snapshot: LegacyAuthorizationSnapshot | null | undefined) {
  if (shouldRetrySparseAuthorization(snapshot)) {
    scheduleSparseRetry(scope)
    return
  }

  clearSparseRetry(scope)
  scope.sparseRetryAttempts = 0
}

function resetOnFingerprintChange() {
  const fingerprint = authFingerprint()
  if (fingerprint && fingerprint !== lastAuthFingerprint) {
    for (const scope of scopes.values()) {
      clearSparseRetry(scope)
      scope.sparseRetryAttempts = 0
    }
    lastAuthFingerprint = fingerprint
  }
}

async function loadScope(scope: AuthorizationScope, options: LoadAuthorizationOptions = {}) {
  resetOnFingerprintChange()
  const { state } = scope

  if (options.force) {
    const generation = scope.forcedLoadGeneration + 1
    scope.forcedLoadGeneration = generation
    state.clear()
    state.loading.value = true
    state.error.value = null

    try {
      const snapshot = await fetchAuthorizationSnapshotWithRefresh(scope.source)

      if (generation === scope.forcedLoadGeneration) {
        state.snapshot.value = snapshot
        state.loaded.value = true
        state.loading.value = false
        state.error.value = null
      }

      settleSparseRetry(scope, snapshot)
      return snapshot
    } catch (error) {
      if (generation === scope.forcedLoadGeneration) {
        state.snapshot.value = emptyAuthorization
        state.error.value = error
        state.loaded.value = true
        state.loading.value = false
      }

      scheduleSparseRetry(scope)
      return emptyAuthorization
    }
  }

  const snapshot = await state.load()
  if (state.error.value) {
    // createAuthorizationState keeps the failure in `error`; retry with backoff.
    scheduleSparseRetry(scope)
    return emptyAuthorization
  }
  const resolved = snapshot || emptyAuthorization
  settleSparseRetry(scope, resolved)
  return resolved
}

// The snapshot of a Host page follows the module that owns the page. Inside a
// component the page's own route is used (correct during page transitions);
// in middleware/plugins the router's current route is used.
function captureRouteMeta(): () => unknown {
  if (getCurrentInstance()) {
    const route = useRoute()
    return () => route.meta
  }
  const router = useRouter()
  return () => router.currentRoute.value.meta
}

export function useAuthorization(options: { routeMeta?: () => unknown } = {}) {
  const publicConfig = useRuntimeConfig().public
  const hostMode = isEnterpriseHostAuthorization(publicConfig)
  const componentApp = getCurrentInstance() ? inject(authorizationModuleScope, null) : null
  const routeMeta = hostMode ? options.routeMeta || (componentApp ? () => ({ authorizationApp: componentApp }) : captureRouteMeta()) : () => undefined

  function currentScope() {
    const source = resolveAuthorizationSnapshotSource(publicConfig, routeMeta())
    return source ? scopeFor(source) : null
  }

  const authorizationApp = computed(() => currentScope()?.source.expectedApp || null)

  async function loadAuthorization(options: LoadAuthorizationOptions = {}) {
    const scope = currentScope()
    // A Host page that belongs to no business module has no module permissions.
    if (!scope) return emptyAuthorization
    return await loadScope(scope, options)
  }

  function getAuthorization() {
    const scope = currentScope()
    if (!scope) return hostMode ? emptyAuthorization : null
    // Host pages composed from a module never ran that module's own permission
    // middleware/layout, so the first read of a module snapshot loads it.
    if (hostMode && import.meta.client && !scope.state.loaded.value && !scope.state.loading.value) {
      queueMicrotask(() => {
        if (!scope.state.loaded.value && !scope.state.loading.value) void loadScope(scope)
      })
    }
    return scope.state.snapshot.value
  }

  function clearAuthorizationCache() {
    for (const scope of scopes.values()) {
      clearSparseRetry(scope)
      scope.state.clear()
    }
  }

  const loaded = computed(() => {
    const scope = currentScope()
    return scope ? scope.state.loaded.value : true
  })
  const loading = computed(() => currentScope()?.state.loading.value ?? false)
  const error = computed(() => currentScope()?.state.error.value ?? null)

  if (import.meta.client && !authWatcherInstalled) {
    authWatcherInstalled = true
    // Detached: the watcher outlives whichever component happened to install it.
    effectScope(true).run(() => {
      watch(authFingerprint, (fingerprint, previousFingerprint) => {
        if (!fingerprint.startsWith('1|') || fingerprint === previousFingerprint) return
        // Identity or policy changed: every module snapshot already requested
        // is reloaded; none keeps the previous identity's permissions.
        for (const scope of scopes.values()) void loadScope(scope, { force: true })
      }, { flush: 'post' })
    })
  }

  return {
    loadAuthorization,
    getAuthorization,
    clearAuthorizationCache,
    /** Owning module of the current Host page; null for standalone applications. */
    authorizationApp,
    loaded,
    loading,
    error
  }
}
