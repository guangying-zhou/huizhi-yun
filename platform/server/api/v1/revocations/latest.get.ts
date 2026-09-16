import { requireString } from '~~/server/utils/api'
import { findLatestRevocationSnapshot } from '~~/server/utils/platform'
import { buildQueryString, contractOk, resolveDeploymentForV1 } from '~~/server/utils/controlPlaneV1'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const deployment = await resolveDeploymentForV1(event, {
    deploymentId: query.deploymentId || query.deploymentCode,
    tenantCode
  })
  const snapshot = await findLatestRevocationSnapshot(deployment.id)

  if (!snapshot) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `revocation snapshot not found: deploymentId=${deployment.deployment_code}`
    })
  }

  const params = buildQueryString({
    deploymentId: deployment.deployment_code,
    tenantCode: deployment.tenant_code
  })

  return contractOk({
    tenantCode: deployment.tenant_code,
    deploymentId: deployment.deployment_code,
    revocationVersion: snapshot.snapshot_version,
    revocationHash: snapshot.snapshot_hash,
    downloadUrl: `/api/v1/revocations/${encodeURIComponent(snapshot.snapshot_version)}/download${params}`,
    generatedAt: snapshot.issued_at,
    status: snapshot.status
  })
})
