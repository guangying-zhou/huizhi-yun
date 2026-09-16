import { contractOk, resolveDeploymentForV1 } from '~~/server/utils/controlPlaneV1'
import {
  applySubjectProjectionSync,
  type SubjectProjectionMembershipItem,
  type SubjectProjectionSyncItem
} from '~~/server/utils/subjectProjectionSync'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const deployment = await resolveDeploymentForV1(event, {
    deploymentId: body.deploymentId || body.deploymentCode,
    tenantCode: body.tenantCode
  })

  const snapshotHash = String(body.snapshotHash || '').trim()
  const startsSnapshot = body.resetMemberships !== false
  if (
    startsSnapshot
    && snapshotHash
    && deployment.directory_sync_status === 'healthy'
    && deployment.reported_directory_snapshot_hash === snapshotHash
  ) {
    return contractOk({
      tenantCode: deployment.tenant_code,
      deploymentId: deployment.deployment_code,
      snapshotHash,
      unchanged: true,
      receivedCount: 0,
      acceptedCount: 0,
      skippedCount: 0,
      upsertedCount: 0,
      membershipReceivedCount: 0,
      membershipAcceptedCount: 0,
      membershipUpsertedCount: 0,
      membershipSyncStatus: 'unchanged',
      resetMemberships: false,
      finalized: true
    })
  }

  const result = await applySubjectProjectionSync({
    tenantCode: deployment.tenant_code,
    deploymentId: deployment.id,
    deploymentCode: deployment.deployment_code,
    cursor: body.cursor,
    snapshotHash,
    items: Array.isArray(body.items) ? body.items as SubjectProjectionSyncItem[] : [],
    memberships: Array.isArray(body.memberships) ? body.memberships as SubjectProjectionMembershipItem[] : [],
    resetMemberships: body.resetMemberships,
    finalize: body.finalize
  })

  return contractOk(result)
})
