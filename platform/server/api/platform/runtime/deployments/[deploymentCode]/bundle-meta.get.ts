import { ok, normalizeNullableString, requireString } from '~~/server/utils/api'
import { findDeploymentByCode } from '~~/server/utils/platform'
import {
  findPolicyBundleForDeployment,
  formatPolicyBundleSignature,
  maybeReturnPolicyBundleNotModified
} from '~~/server/utils/policyBundle'

export default defineEventHandler(async (event) => {
  const deploymentCode = requireString(getRouterParam(event, 'deploymentCode'), 'deploymentCode')
  const query = getQuery(event)
  const tenantCode = normalizeNullableString(query.tenantCode)
  const deployment = await findDeploymentByCode(deploymentCode, tenantCode)
  const bundle = await findPolicyBundleForDeployment({
    deploymentId: deployment.id,
    version: normalizeNullableString(query.version || query.bundleVersion)
  })

  if (!bundle) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `bundle not found: deploymentCode=${deploymentCode}` })
  }

  if (maybeReturnPolicyBundleNotModified(event, bundle)) {
    return null
  }

  return ok({
    deploymentCode: deployment.deployment_code,
    tenantCode: deployment.tenant_code,
    bundleVersion: bundle.bundle_version,
    bundleHash: bundle.bundle_hash,
    bundleUri: bundle.bundle_uri,
    schemaVersion: bundle.schema_version,
    issuedAt: bundle.issued_at,
    expiresAt: bundle.expires_at,
    status: bundle.status,
    ...formatPolicyBundleSignature(bundle)
  })
})
