import { requireString } from '~~/server/utils/api'
import {
  contractOk,
  findBundleVersionForDeployment,
  parseBundlePayload,
  resolveDeploymentForV1
} from '~~/server/utils/controlPlaneV1'
import {
  formatPolicyBundleSignature,
  maybeReturnPolicyBundleNotModified
} from '~~/server/utils/policyBundle'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const bundleVersion = requireString(getRouterParam(event, 'bundleVersion'), 'bundleVersion')
  const deployment = await resolveDeploymentForV1(event, {
    deploymentId: query.deploymentId || query.deploymentCode,
    tenantCode: query.tenantCode
  })
  const bundle = await findBundleVersionForDeployment(bundleVersion, deployment.id)

  if (!bundle) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `bundle not found: bundleVersion=${bundleVersion}, deploymentId=${deployment.deployment_code}`
    })
  }

  if (maybeReturnPolicyBundleNotModified(event, bundle)) {
    return null
  }

  const signature = formatPolicyBundleSignature(bundle)

  return contractOk({
    bundleVersion: bundle.bundle_version,
    tenantCode: bundle.tenant_code,
    deploymentId: deployment.deployment_code,
    bundleHash: bundle.bundle_hash,
    bundle: parseBundlePayload(bundle.bundle_payload_json),
    bundleUri: bundle.bundle_uri,
    signature: signature.signature,
    kid: signature.kid,
    signedByKid: signature.kid,
    alg: signature.alg,
    signedAt: signature.signedAt,
    schemaVersion: bundle.schema_version,
    generatedAt: bundle.issued_at,
    expiresAt: bundle.expires_at,
    status: bundle.status
  })
})
