import { ok, normalizeNullableString, requireString } from '~~/server/utils/api'
import { findDeploymentByCode, findLatestBundle, findLatestLicense, findLatestRevocationSnapshot } from '~~/server/utils/platform'

export default defineEventHandler(async (event) => {
  const deploymentCode = requireString(getRouterParam(event, 'deploymentCode'), 'deploymentCode')
  const tenantCode = normalizeNullableString(getQuery(event).tenantCode)
  const deployment = await findDeploymentByCode(deploymentCode, tenantCode)
  const [license, bundle, revocation] = await Promise.all([
    findLatestLicense(deployment.id),
    findLatestBundle(deployment.id),
    findLatestRevocationSnapshot(deployment.id)
  ])

  return ok({
    deploymentCode: deployment.deployment_code,
    tenantCode: deployment.tenant_code,
    appCode: deployment.app_code,
    deploymentStatus: deployment.status,
    licenseStatus: license?.status || deployment.license_status,
    connectivityStatus: deployment.connectivity_status,
    versionStatus: deployment.version_status,
    reportedAppVersion: deployment.reported_app_version,
    reportedManifestVersion: deployment.reported_manifest_version,
    reportedManifestHash: deployment.reported_manifest_hash,
    reportedSdkVersion: deployment.reported_sdk_version,
    lastReportedAt: deployment.last_reported_at,
    bundleVersion: bundle?.bundle_version || null,
    revocationVersion: revocation?.snapshot_version || null,
    lastHeartbeatAt: deployment.last_heartbeat_at,
    updatedAt: deployment.updated_at
  })
})
