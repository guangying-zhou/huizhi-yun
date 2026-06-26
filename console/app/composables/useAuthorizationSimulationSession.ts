type AuthorizationSimulationMode = 'role_simulation' | 'user_simulation'

export interface AuthorizationSimulationSession {
  active: boolean
  sid: string | null
  mode: AuthorizationSimulationMode | null
  actorUid: string | null
  roleCode: string | null
  subjectCode: string | null
  includeBaseline: boolean
  reason: string | null
  issuedAt: string | null
  expiresAt: string | null
}

interface AuthorizationSimulationSessionResponse {
  code: number
  data?: Partial<AuthorizationSimulationSession>
}

interface AuthorizationPermissionsResponse {
  code: number
  data?: {
    resources?: Record<string, string[]>
  }
}

export interface CreateAuthorizationSimulationSessionInput {
  mode: AuthorizationSimulationMode
  roleCode?: string | null
  subjectCode?: string | null
  includeBaseline?: boolean
  ttlMinutes?: number | null
  reason?: string | null
}

function inactiveSession(): AuthorizationSimulationSession {
  return {
    active: false,
    sid: null,
    mode: null,
    actorUid: null,
    roleCode: null,
    subjectCode: null,
    includeBaseline: true,
    reason: null,
    issuedAt: null,
    expiresAt: null
  }
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function statusCode(error: unknown) {
  const record = error as {
    status?: number
    statusCode?: number
    response?: { status?: number, statusCode?: number }
  } | null | undefined

  return Number(record?.statusCode || record?.status || record?.response?.statusCode || record?.response?.status || 0)
}

function normalizeSession(data: Partial<AuthorizationSimulationSession> | null | undefined): AuthorizationSimulationSession {
  if (!data?.active) {
    return inactiveSession()
  }

  const mode = data.mode === 'user_simulation' ? 'user_simulation' : 'role_simulation'
  return {
    active: true,
    sid: stringValue(data.sid) || null,
    mode,
    actorUid: stringValue(data.actorUid) || null,
    roleCode: stringValue(data.roleCode) || null,
    subjectCode: stringValue(data.subjectCode) || null,
    includeBaseline: data.includeBaseline !== false,
    reason: stringValue(data.reason) || null,
    issuedAt: stringValue(data.issuedAt) || null,
    expiresAt: stringValue(data.expiresAt) || null
  }
}

export function useAuthorizationSimulationSession() {
  const session = useState<AuthorizationSimulationSession>('console:authorization-simulation-session', inactiveSession)
  const loaded = useState('console:authorization-simulation-session-loaded', () => false)
  const loading = useState('console:authorization-simulation-session-loading', () => false)
  const ending = useState('console:authorization-simulation-session-ending', () => false)
  const capabilityLoaded = useState('console:authorization-simulation-capability-loaded', () => false)
  const capabilityLoading = useState('console:authorization-simulation-capability-loading', () => false)
  const canSimulateRole = useState('console:authorization-simulation-can-role', () => false)
  const canSimulateUser = useState('console:authorization-simulation-can-user', () => false)

  function setInactive() {
    session.value = inactiveSession()
    loaded.value = true
  }

  async function refreshPermissions() {
    const { clearCache, loadPermissions } = usePermissions()
    clearCache()
    await loadPermissions({ force: true })
  }

  async function loadPlatformSimulationCapabilities(options: { force?: boolean } = {}) {
    if (capabilityLoading.value) {
      return {
        canSimulateRole: canSimulateRole.value,
        canSimulateUser: canSimulateUser.value
      }
    }
    if (capabilityLoaded.value && !options.force) {
      return {
        canSimulateRole: canSimulateRole.value,
        canSimulateUser: canSimulateUser.value
      }
    }

    capabilityLoading.value = true
    try {
      const response = await $fetch<AuthorizationPermissionsResponse>('/api/auth/permissions', {
        query: { appCode: 'platform' }
      })
      const actions = response.data?.resources?.authorization || []
      canSimulateRole.value = actions.includes('simulate-role')
      canSimulateUser.value = actions.includes('simulate-user')
      capabilityLoaded.value = true
    } catch (error) {
      if (![401, 403].includes(statusCode(error))) {
        console.warn('[AuthorizationSimulation] Failed to load platform capabilities:', error)
      }
      canSimulateRole.value = false
      canSimulateUser.value = false
      capabilityLoaded.value = true
    } finally {
      capabilityLoading.value = false
    }

    return {
      canSimulateRole: canSimulateRole.value,
      canSimulateUser: canSimulateUser.value
    }
  }

  async function loadSession(options: { force?: boolean } = {}) {
    if (loading.value) {
      return session.value
    }
    if (loaded.value && !options.force) {
      return session.value
    }

    loading.value = true
    try {
      const response = await $fetch<AuthorizationSimulationSessionResponse>('/api/v1/console/authorization/simulation-sessions/current')
      session.value = normalizeSession(response.data)
      loaded.value = true
      return session.value
    } catch (error) {
      if (![401, 403].includes(statusCode(error))) {
        console.warn('[AuthorizationSimulation] Failed to load current session:', error)
      }
      setInactive()
      return session.value
    } finally {
      loading.value = false
    }
  }

  async function startSession(input: CreateAuthorizationSimulationSessionInput) {
    const response = await $fetch<AuthorizationSimulationSessionResponse>('/api/v1/console/authorization/simulation-sessions', {
      method: 'POST',
      body: input
    })

    session.value = normalizeSession(response.data)
    loaded.value = true
    await refreshPermissions()
    return session.value
  }

  async function endSession() {
    if (ending.value) {
      return
    }

    ending.value = true
    try {
      await $fetch('/api/v1/console/authorization/simulation-sessions/current', {
        method: 'DELETE'
      })
      setInactive()
      await refreshPermissions()
    } finally {
      ending.value = false
    }
  }

  return {
    session,
    active: computed(() => session.value.active),
    loaded,
    loading,
    ending,
    capabilityLoaded,
    capabilityLoading,
    canSimulateRole,
    canSimulateUser,
    loadSession,
    loadPlatformSimulationCapabilities,
    startSession,
    endSession,
    clearSession: setInactive
  }
}
