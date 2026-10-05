import { createError, defineEventHandler, getQuery, setHeader } from 'h3'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { logAuthDependencyFailure } from '@hzy/foundation/server/utils/authDependencyDiagnostic'
import { requireCurrentEnterprisePolicy } from '../../../../utils/enterprisePolicyGate'
import { resolveHostAuthorizationApp } from '../../../../utils/hostAuthorizationApps'

function statusOf(error: unknown) {
  const failure = error as { statusCode?: unknown, status?: unknown } | null
  return Number(failure?.statusCode || failure?.status || 0)
}

// Browser permission snapshot for one composed module. It is a UI hint only:
// every Host handler still re-authorizes with the same Console snapshot. The
// snapshot is the normal merged grant of the verified Host user (no role
// switching); modules are never merged because resource codes collide.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await requireEnterpriseUser(event)
  const appCode = resolveHostAuthorizationApp(getQuery(event))
  await requireCurrentEnterprisePolicy(event, user)
  const startedAt = Date.now()
  let snapshot: Awaited<ReturnType<typeof loadAuthorizationSnapshotFromConsoleRuntime>> | null = null
  try {
    snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, appCode, event)
  } catch (error) {
    logAuthDependencyFailure(event, `permissions-${appCode}`, error, Date.now() - startedAt)
    const status = statusOf(error)
    if (status === 401 || status === 403) throw error
  }
  // Never an empty 200: a missing or malformed snapshot is a dependency failure.
  if (!snapshot || !snapshot.resources || typeof snapshot.resources !== 'object' || Array.isArray(snapshot.resources)) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Authorization Unavailable',
      message: 'Console authorization unavailable',
      data: { code: 'enterprise_authorization_unavailable' }
    })
  }
  return {
    code: 0,
    data: {
      appCode,
      uid: snapshot.uid || user.uid,
      roles: snapshot.roles || [],
      availableRoles: [],
      activeRoleCode: '',
      resources: snapshot.resources,
      actionPolicies: snapshot.actionPolicies || {}
    }
  }
})
