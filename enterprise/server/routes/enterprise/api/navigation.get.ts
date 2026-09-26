import { defineEventHandler, setHeader } from 'h3'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { isTenantRuntimeEnabled } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { enterpriseNavigation } from '../../../../app/utils/enterprise-navigation'
import { navigationLeaves, resolveNavigationAccess, NAVIGATION_MAX_AGE_MS } from '../../../../shared/navigation-access.mjs'
import { requireCurrentEnterprisePolicy } from '../../../utils/enterprisePolicyGate'
import { logAuthDependencyFailure } from '@hzy/foundation/server/utils/authDependencyDiagnostic'

const items = navigationLeaves(enterpriseNavigation.businessNavigation, enterpriseNavigation.objectWorkspaces)

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await requireEnterpriseUser(event)
  const policyStartedAt = Date.now()
  try {
    await requireCurrentEnterprisePolicy(event, user)
  } catch (error) {
    logAuthDependencyFailure(event, 'enterprise-policy-gate', error, Date.now() - policyStartedAt)
    throw error
  }
  const navigationStartedAt = Date.now()
  let visibleIds
  try {
    visibleIds = await resolveNavigationAccess(items, {
    // This release contributes only registered pages. Runtime availability is
    // resolved from server-controlled configuration / authenticated Gateway,
    // never browser query parameters, module headers or local preferences.
    available: isTenantRuntimeEnabled(event, 'enterprise'),
    load: async (module: string) => {
      const startedAt = Date.now()
      try {
        return await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, module, event)
      } catch (error) {
        if (['aims', 'assets', 'codocs'].includes(module)) {
          logAuthDependencyFailure(event, `navigation-${module}`, error, Date.now() - startedAt)
        }
        throw error
      }
    },
    allows: (snapshot: Awaited<ReturnType<typeof loadAuthorizationSnapshotFromConsoleRuntime>>, permission: { resource: string, action: string }) =>
      authorizationResourcesAllow(snapshot.resources, permission.resource, permission.action, snapshot.actionPolicies?.[permission.resource])
    })
  } catch (error) {
    logAuthDependencyFailure(event, 'navigation-authorization', error, Date.now() - navigationStartedAt)
    throw error
  }
  return { visibleIds, maxAgeMs: NAVIGATION_MAX_AGE_MS }
})
