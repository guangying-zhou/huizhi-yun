import type { H3Event } from 'h3'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { requireCurrentEnterprisePolicy } from './enterprisePolicyGate'

export async function consoleDirectoryEditPermission(event: H3Event, resource: string) {
  const user = await requireEnterpriseUser(event)
  await requireCurrentEnterprisePolicy(event, user)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'console', event)
  return authorizationResourcesAllow(snapshot.resources, resource, 'edit', snapshot.actionPolicies?.[resource])
}
