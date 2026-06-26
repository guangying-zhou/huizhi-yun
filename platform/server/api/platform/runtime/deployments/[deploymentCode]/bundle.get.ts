import { ok, requireString } from '~~/server/utils/api'
import { buildAuthorizationSnapshot } from '~~/server/utils/authorization'
import { findDeploymentByCode, findLatestLicense } from '~~/server/utils/platform'
import {
  findOrGeneratePolicyBundleForDeployment,
  formatPolicyBundleSignature,
  maybeReturnPolicyBundleNotModified,
  parsePolicyBundlePayload
} from '~~/server/utils/policyBundle'

function queryValue(value: unknown) {
  return String(Array.isArray(value) ? value[0] : value || '').trim() || null
}

export default defineEventHandler(async (event) => {
  const deploymentCode = requireString(getRouterParam(event, 'deploymentCode'), 'deploymentCode')
  const query = getQuery(event)
  const tenantCode = queryValue(query.tenantCode)
  const deployment = await findDeploymentByCode(deploymentCode, tenantCode)
  if (deployment.status !== 'active') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `deployment is not active: deploymentCode=${deploymentCode}, status=${deployment.status}`
    })
  }

  const bundle = await findOrGeneratePolicyBundleForDeployment({
    deploymentId: deployment.id,
    tenantCode: deployment.tenant_code,
    version: queryValue(query.version) || queryValue(query.bundleVersion)
  })
  const license = await findLatestLicense(deployment.id)

  if (!bundle) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `bundle not found: deploymentCode=${deploymentCode}` })
  }

  if (maybeReturnPolicyBundleNotModified(event, bundle)) {
    return null
  }

  const uid = queryValue(query.uid)
  const snapshot = uid
    ? await buildAuthorizationSnapshot(deployment.tenant_code, uid, queryValue(query.appCode), {
        activeRoleCode: queryValue(query.activeRoleCode),
        authorizationMode: queryValue(query.authorizationMode)
      })
    : null

  return ok({
    deployment: {
      deploymentCode: deployment.deployment_code,
      tenantCode: deployment.tenant_code,
      deploymentName: deployment.deployment_name,
      deploymentMode: deployment.deployment_mode,
      status: deployment.status
    },
    license: license
      ? {
          licenseCode: license.license_code,
          planCode: license.plan_code,
          status: license.status,
          issuedAt: license.issued_at,
          expiresAt: license.expires_at,
          graceUntil: license.grace_until
        }
      : null,
    bundle: {
      bundleVersion: bundle.bundle_version,
      bundleHash: bundle.bundle_hash,
      bundleUri: bundle.bundle_uri,
      schemaVersion: bundle.schema_version,
      issuedAt: bundle.issued_at,
      expiresAt: bundle.expires_at,
      status: bundle.status,
      ...formatPolicyBundleSignature(bundle),
      payload: parsePolicyBundlePayload(bundle.bundle_payload_json)
    },
    authorizationSnapshot: snapshot
  })
})
