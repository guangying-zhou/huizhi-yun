import { ok, normalizeNullableString, requireString } from '~~/server/utils/api'
import { findDeploymentByCode, findLatestRevocationSnapshot } from '~~/server/utils/platform'

export default defineEventHandler(async (event) => {
  const deploymentCode = requireString(getRouterParam(event, 'deploymentCode'), 'deploymentCode')
  const tenantCode = normalizeNullableString(getQuery(event).tenantCode)
  const deployment = await findDeploymentByCode(deploymentCode, tenantCode)
  const snapshot = await findLatestRevocationSnapshot(deployment.id)

  if (!snapshot) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `revocation snapshot not found: deploymentCode=${deploymentCode}` })
  }

  return ok({
    deployment: {
      deploymentCode: deployment.deployment_code,
      tenantCode: deployment.tenant_code
    },
    snapshot: {
      snapshotVersion: snapshot.snapshot_version,
      snapshotHash: snapshot.snapshot_hash,
      snapshotUri: snapshot.snapshot_uri,
      issuedAt: snapshot.issued_at,
      status: snapshot.status
    },
    revokedSubjects: [],
    revokedTokens: []
  })
})
