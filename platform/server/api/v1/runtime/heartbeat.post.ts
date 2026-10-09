import type { ResultSetHeader } from 'mysql2/promise'
import { execute } from '~~/server/utils/db'
import { normalizeNullableString } from '~~/server/utils/api'
import {
  findEffectiveManifestByAppCode,
  findLatestBundle,
  findLatestLicense,
  findLatestRevocationSnapshot,
  parseStoredJson
} from '~~/server/utils/platform'
import { contractOk, resolveDeploymentForV1 } from '~~/server/utils/controlPlaneV1'

type VersionStatus = 'unknown' | 'current' | 'drifted' | 'incompatible'

function parseMajor(version: string | null) {
  if (!version) return null
  const matched = version.match(/^(\d+)/)
  if (!matched) return null
  const major = Number(matched[1])
  return Number.isFinite(major) ? major : null
}

function resolveVersionStatus(input: {
  reportedManifestVersion: string | null
  reportedManifestHash: string | null
  latestManifestVersion: string | null
  latestManifestHash: string | null
}): VersionStatus {
  const { reportedManifestVersion, reportedManifestHash, latestManifestVersion, latestManifestHash } = input

  if (!latestManifestVersion && !latestManifestHash) return 'unknown'
  if (!reportedManifestVersion && !reportedManifestHash) return 'unknown'

  const hasHashMismatch = Boolean(reportedManifestHash && latestManifestHash && reportedManifestHash !== latestManifestHash)
  const hasVersionMismatch = Boolean(reportedManifestVersion && latestManifestVersion && reportedManifestVersion !== latestManifestVersion)

  if (!hasHashMismatch && !hasVersionMismatch) return 'current'

  if (hasVersionMismatch) {
    const reportedMajor = parseMajor(reportedManifestVersion)
    const latestMajor = parseMajor(latestManifestVersion)
    if (reportedMajor !== null && latestMajor !== null && reportedMajor !== latestMajor) {
      return 'incompatible'
    }
  }

  return 'drifted'
}

function normalizeDate(value: unknown) {
  const rawValue = normalizeNullableString(value)
  const normalizedValue = rawValue && rawValue.includes('T')
    ? rawValue
    : rawValue
      ? `${rawValue.replace(' ', 'T')}Z`
      : ''
  const date = normalizedValue ? new Date(normalizedValue) : new Date()

  return Number.isNaN(date.getTime()) ? new Date() : date
}

function toSqlDate(value: Date) {
  return value.toISOString().slice(0, 19).replace('T', ' ')
}

function normalizeSigningKey(body: Record<string, unknown>) {
  const signingKey = body.signingKey && typeof body.signingKey === 'object' && !Array.isArray(body.signingKey)
    ? body.signingKey as Record<string, unknown>
    : {}

  return {
    kid: normalizeNullableString(signingKey.kid || body.currentKid),
    fingerprint: normalizeNullableString(signingKey.fingerprint || body.currentPubkeyFingerprint),
    rotatedAt: normalizeNullableString(signingKey.rotatedAt || body.lastKeyRotatedAt)
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const deployment = await resolveDeploymentForV1(event, {
    deploymentId: body.deploymentId || body.deploymentCode,
    tenantCode: body.tenantCode
  })
  const runtimeId = normalizeNullableString(body.runtimeId) || deployment.deployment_code
  const appVersion = normalizeNullableString(body.appVersion) || normalizeNullableString(body.reportedAppVersion)
  const manifestVersion = normalizeNullableString(body.manifestVersion) || normalizeNullableString(body.reportedManifestVersion)
  const manifestHash = normalizeNullableString(body.manifestHash) || normalizeNullableString(body.reportedManifestHash)
  const bundleVersion = normalizeNullableString(body.bundleVersion) || normalizeNullableString(body.currentBundleVersion)
  const revocationVersion = normalizeNullableString(body.revocationVersion) || normalizeNullableString(body.currentRevocationVersion)
  const sdkVersion = normalizeNullableString(body.sdkVersion) || normalizeNullableString(body.reportedSdkVersion)
  const licenseStatusSeen = normalizeNullableString(body.licenseStatusSeen)
  const heartbeatDate = normalizeDate(body.heartbeatAt)
  const heartbeatAt = toSqlDate(heartbeatDate)
  const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
    ? body.payload
    : body.coarseMetrics && typeof body.coarseMetrics === 'object' && !Array.isArray(body.coarseMetrics)
      ? body.coarseMetrics
      : null
  const signingKey = normalizeSigningKey(body)

  const effectiveManifest = await findEffectiveManifestByAppCode(deployment.app_code)
  const versionStatus = resolveVersionStatus({
    reportedManifestVersion: manifestVersion,
    reportedManifestHash: manifestHash,
    latestManifestVersion: effectiveManifest ? String(effectiveManifest.manifest_seq) : null,
    latestManifestHash: effectiveManifest?.manifest_hash || null
  })

  await execute<ResultSetHeader>(
    `INSERT INTO deployment_heartbeats
      (deployment_id, runtime_id, app_version, manifest_version, manifest_hash,
       bundle_version, revocation_version, sdk_version, license_status_seen, heartbeat_at, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      deployment.id,
      runtimeId,
      appVersion,
      manifestVersion,
      manifestHash,
      bundleVersion,
      revocationVersion,
      sdkVersion,
      licenseStatusSeen,
      heartbeatAt,
      payload ? JSON.stringify(payload) : null
    ]
  )

  await execute<ResultSetHeader>(
    `UPDATE deployments
     SET last_heartbeat_at = ?,
         reported_app_version = ?,
         reported_manifest_version = ?,
         reported_manifest_hash = ?,
         reported_sdk_version = ?,
         last_reported_at = ?,
         version_status = ?,
         connectivity_status = 'passed',
         last_connectivity_check_at = ?,
         last_connectivity_check_status = 'passed',
         last_connectivity_check_summary = 'runtime heartbeat accepted',
         connectivity_verified_at = COALESCE(connectivity_verified_at, ?),
         current_kid = COALESCE(?, current_kid),
         current_pubkey_fingerprint = COALESCE(?, current_pubkey_fingerprint),
         last_kid_reported_at = CASE WHEN ? IS NULL THEN last_kid_reported_at ELSE ? END,
         last_key_rotated_at = COALESCE(?, last_key_rotated_at),
         updated_at = NOW()
     WHERE id = ?`,
    [
      heartbeatAt,
      appVersion,
      manifestVersion,
      manifestHash,
      sdkVersion,
      heartbeatAt,
      versionStatus,
      heartbeatAt,
      heartbeatAt,
      signingKey.kid,
      signingKey.fingerprint,
      signingKey.kid,
      heartbeatAt,
      signingKey.rotatedAt,
      deployment.id
    ]
  )

  const [latestLicense, latestBundle, latestRevocation] = await Promise.all([
    findLatestLicense(deployment.id),
    findLatestBundle(deployment.id),
    findLatestRevocationSnapshot(deployment.id)
  ])
  const actions: Array<{ type: string, version: string }> = []
  if (latestBundle?.bundle_version && latestBundle.bundle_version !== bundleVersion) {
    actions.push({ type: 'download_bundle', version: latestBundle.bundle_version })
  }
  if (latestRevocation?.snapshot_version && latestRevocation.snapshot_version !== revocationVersion) {
    actions.push({ type: 'download_revocations', version: latestRevocation.snapshot_version })
  }

  return contractOk({
    serverTime: new Date().toISOString(),
    deploymentId: deployment.deployment_code,
    tenantCode: deployment.tenant_code,
    licenseStatus: latestLicense?.status || deployment.license_status,
    graceDeadline: latestLicense?.grace_until || null,
    versionStatus,
    latestBundleVersion: latestBundle?.bundle_version || null,
    latestRevocationVersion: latestRevocation?.snapshot_version || null,
    nextSuggestedHeartbeatAt: new Date(heartbeatDate.getTime() + 5 * 60 * 1000).toISOString(),
    actions,
    acceptedPayload: parseStoredJson<Record<string, unknown>>(payload)
  })
})
