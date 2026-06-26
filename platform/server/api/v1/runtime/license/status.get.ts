import { contractOk, resolveDeploymentForV1 } from '~~/server/utils/controlPlaneV1'
import { findLatestLicense } from '~~/server/utils/platform'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const deployment = await resolveDeploymentForV1(event, {
    deploymentId: query.deploymentId || query.deploymentCode,
    tenantCode: query.tenantCode
  })
  const license = await findLatestLicense(deployment.id)

  return contractOk({
    deploymentId: deployment.deployment_code,
    tenantCode: deployment.tenant_code,
    status: license?.status || deployment.license_status,
    licenseCode: license?.license_code || null,
    planCode: license?.plan_code || null,
    softExpiry: license?.expires_at || null,
    hardExpiry: license?.grace_until || license?.expires_at || null,
    graceDeadline: license?.grace_until || null
  })
})
