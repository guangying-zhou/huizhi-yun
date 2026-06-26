import { requireString } from '~~/server/utils/api'
import {
  contractOk,
  findRevocationVersionForDeployment,
  parseRevocationEntries,
  resolveDeploymentForV1
} from '~~/server/utils/controlPlaneV1'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const revocationVersion = requireString(getRouterParam(event, 'revocationVersion'), 'revocationVersion')
  const deployment = await resolveDeploymentForV1(event, {
    deploymentId: query.deploymentId || query.deploymentCode,
    tenantCode: query.tenantCode
  })
  const snapshot = await findRevocationVersionForDeployment(revocationVersion, deployment.id)

  if (!snapshot) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `revocation snapshot not found: revocationVersion=${revocationVersion}, deploymentId=${deployment.deployment_code}`
    })
  }

  return contractOk({
    revocationVersion: snapshot.snapshot_version,
    tenantCode: snapshot.tenant_code,
    deploymentId: deployment.deployment_code,
    revocationHash: snapshot.snapshot_hash,
    entries: parseRevocationEntries(snapshot.entries_json),
    snapshotUri: snapshot.snapshot_uri,
    signature: snapshot.signature,
    signedByKid: snapshot.signed_by_kid,
    generatedAt: snapshot.issued_at,
    status: snapshot.status
  })
})
