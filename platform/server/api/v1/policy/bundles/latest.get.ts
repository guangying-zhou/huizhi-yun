import { normalizeNullableString, requireString } from '~~/server/utils/api'
import { buildQueryString, contractOk, resolveDeploymentForV1 } from '~~/server/utils/controlPlaneV1'
import {
  findPolicyBundleForDeployment,
  formatPolicyBundleSignature,
  maybeReturnPolicyBundleNotModified
} from '~~/server/utils/policyBundle'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const deployment = await resolveDeploymentForV1(event, {
    deploymentId: query.deploymentId || query.deploymentCode,
    tenantCode
  })
  const bundle = await findPolicyBundleForDeployment({
    deploymentId: deployment.id,
    version: null
  })

  if (!bundle) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `bundle not found: deploymentId=${deployment.deployment_code}`
    })
  }

  if (maybeReturnPolicyBundleNotModified(event, bundle)) {
    return null
  }

  const params = buildQueryString({
    deploymentId: deployment.deployment_code,
    tenantCode: deployment.tenant_code
  })

  return contractOk({
    tenantCode: deployment.tenant_code,
    deploymentId: deployment.deployment_code,
    bundleVersion: bundle.bundle_version,
    bundleHash: bundle.bundle_hash,
    downloadUrl: `/api/v1/policy/bundles/${encodeURIComponent(bundle.bundle_version)}/download${params}`,
    generatedAt: bundle.issued_at,
    expiresAt: bundle.expires_at,
    schemaVersion: bundle.schema_version,
    status: bundle.status,
    ...formatPolicyBundleSignature(bundle),
    appCode: normalizeNullableString(query.appCode)
  })
})
