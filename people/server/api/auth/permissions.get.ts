import { setResponseHeader } from 'h3'
import { requireFoundationSessionUid } from '@hzy/foundation/server/utils/authIdentity'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { appCode } from '~~/app/config/permissions'

export default defineEventHandler(async (event) => {
  const uid = await requireFoundationSessionUid(event, 'People permissions require login')
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(uid, appCode, event)

  setResponseHeader(event, 'cache-control', 'private, no-store')

  return {
    code: 0,
    data: {
      uid: snapshot.uid,
      roles: snapshot.roles,
      availableRoles: snapshot.availableRoles,
      activeRoleCode: snapshot.activeRoleCode,
      authorizationMode: snapshot.authorizationMode,
      resources: snapshot.resources,
      actionPolicies: snapshot.actionPolicies,
      bundleVersion: snapshot.bundleVersion,
      bundleHash: snapshot.bundleHash,
      policyRevision: snapshot.policyRevision
    }
  }
})
