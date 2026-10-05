import { normalizeNullableString, requireString } from '~~/server/utils/api'
import { currentPolicyEnvelope, currentPolicyRevision, policyDeploymentRefusal } from '~~/server/utils/currentPolicyEnvelope'
import { contractOk, buildQueryString, resolveDeploymentForV1 } from '~~/server/utils/controlPlaneV1'
import {
  findOrGeneratePolicyBundleForDeployment,
  formatPolicyBundleSignature,
  maybeReturnPolicyBundleNotModified,
  parsePolicyBundlePayload
} from '~~/server/utils/policyBundle'

export default defineEventHandler(async (event) => {
  const deploymentCode = requireString(getRouterParam(event, 'deploymentCode'), 'deploymentCode')
  const query = getQuery(event)
  const tenantCode = normalizeNullableString(query.tenantCode)
  const deployment = await resolveDeploymentForV1(event, {
    deploymentId: deploymentCode,
    tenantCode
  })
  const signedPolicy = query.format === 'hzy-policy-envelope.v1' || query.format === 'hzy-policy-revision.v1'
  if (deployment.status !== 'active') {
    if (signedPolicy) throw policyDeploymentRefusal('inactive')
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `deployment is not active: deploymentCode=${deploymentCode}, status=${deployment.status}`
    })
  }

  if (signedPolicy) {
    if (query.version || query.bundleVersion) throw createError({ statusCode: 400, message: 'Historical policy envelopes cannot be renewed' })
    return contractOk(query.format === 'hzy-policy-revision.v1'
      ? await currentPolicyRevision(event, deployment)
      : await currentPolicyEnvelope(event, deployment))
  }
  const bundle = await findOrGeneratePolicyBundleForDeployment({
    deploymentId: deployment.id,
    tenantCode: deployment.tenant_code,
    version: normalizeNullableString(query.version || query.bundleVersion)
  })

  if (!bundle) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `bundle not found: deploymentCode=${deploymentCode}`
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
    deploymentId: deployment.deployment_code,
    tenantCode: deployment.tenant_code,
    bundleVersion: bundle.bundle_version,
    bundleHash: bundle.bundle_hash,
    policyRevision: Number(bundle.policy_revision || 0),
    policyHash: bundle.policy_hash,
    downloadUrl: `/api/v1/policy/bundles/${encodeURIComponent(bundle.bundle_version)}/download${params}`,
    generatedAt: bundle.issued_at,
    expiresAt: bundle.expires_at,
    schemaVersion: bundle.schema_version,
    status: bundle.status,
    ...formatPolicyBundleSignature(bundle),
    bundle: parsePolicyBundlePayload(bundle.bundle_payload_json)
  })
})
