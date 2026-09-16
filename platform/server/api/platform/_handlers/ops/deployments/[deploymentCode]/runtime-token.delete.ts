import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { findDeploymentByCode } from '~~/server/utils/platform'
import { revokeRuntimeToken } from '~~/server/utils/runtimeToken'

export default defineEventHandler(async (event) => {
  const deploymentCode = requireString(getRouterParam(event, 'deploymentCode'), 'deploymentCode')
  const tenantCode = normalizeNullableString(getQuery(event).tenantCode)
  const deployment = await findDeploymentByCode(deploymentCode, tenantCode)
  const affectedRows = await revokeRuntimeToken(deployment.tenant_code)

  if (affectedRows === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `runtime credential not found: tenantCode=${deployment.tenant_code}`
    })
  }

  return ok({
    tenantCode: deployment.tenant_code,
    deploymentCode: deployment.deployment_code,
    revoked: true
  })
})
