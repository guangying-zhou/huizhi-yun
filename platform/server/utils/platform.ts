import type { RowDataPacket } from 'mysql2/promise'
import { queryRow } from '~~/server/utils/db'

export interface TenantScopedDeploymentRow extends RowDataPacket {
  id: number
  tenant_code: string
  app_code: string
  deployment_code: string
  deployment_name: string
  deployment_mode: string
  environment: string
  status: string
  license_status: string
  connectivity_status: string
  reported_app_version: string | null
  reported_manifest_version: string | null
  reported_manifest_hash: string | null
  reported_sdk_version: string | null
  last_reported_at: string | null
  version_status: string
  last_heartbeat_at: string | null
  created_at: string
  updated_at: string
}

export interface LicenseRow extends RowDataPacket {
  id: number
  tenant_code: string
  deployment_id: number
  subscription_id: number
  license_code: string
  plan_code: string
  status: string
  issued_at: string
  expires_at: string | null
  grace_until: string | null
  payload_hash: string
  created_at: string
  updated_at: string
}

export interface PolicyBundleRow extends RowDataPacket {
  id: number
  tenant_code: string
  deployment_id: number
  bundle_id: number
  bundle_version: string
  bundle_hash: string
  bundle_payload_json: unknown
  bundle_uri: string
  signature: string | null
  signed_by_kid: string | null
  signed_at: string | null
  schema_version: string
  issued_at: string
  expires_at: string | null
  status: string
  created_at: string
}

export interface RevocationSnapshotRow extends RowDataPacket {
  id: number
  tenant_code: string
  deployment_id: number
  snapshot_id: number
  snapshot_version: string
  snapshot_hash: string
  snapshot_uri: string
  issued_at: string
  status: string
  created_at: string
}

export interface PlatformManifestRow extends RowDataPacket {
  app_code: string
  manifest_seq: number
  manifest_hash: string
  manifest_json: unknown
  created_at: string
}

export function parseStoredJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }

  return value as T
}

export async function findDeploymentByCode(deploymentCode: string, tenantCode?: string | null) {
  const deployment = await queryRow<TenantScopedDeploymentRow>(
    `SELECT id, tenant_code, app_code, deployment_code, deployment_name, deployment_mode, environment, status,
            license_status, connectivity_status,
            reported_app_version, reported_manifest_version, reported_manifest_hash,
            reported_sdk_version, last_reported_at, version_status,
            last_heartbeat_at, created_at, updated_at
     FROM deployments
     WHERE deployment_code = ?
       ${tenantCode ? 'AND tenant_code = ?' : ''}
     LIMIT 1`,
    tenantCode ? [deploymentCode, tenantCode] : [deploymentCode]
  )

  if (!deployment) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `deployment not found: deploymentCode=${deploymentCode}`
    })
  }

  return deployment
}

export async function findLatestLicense(deploymentId: number) {
  return queryRow<LicenseRow>(
    `SELECT l.id, l.tenant_code, ld.deployment_id, l.subscription_id, l.license_code, l.plan_code, l.status,
            l.issued_at, l.expires_at, l.grace_until, l.payload_hash, l.created_at, l.updated_at
     FROM license_deployments ld
     INNER JOIN licenses l ON l.id = ld.license_id
     WHERE ld.deployment_id = ?
       AND ld.status = 'active'
       AND (ld.effective_until IS NULL OR ld.effective_until > UTC_TIMESTAMP())
     ORDER BY l.issued_at DESC, l.id DESC
     LIMIT 1`,
    [deploymentId]
  )
}

export async function findLatestBundle(deploymentId: number) {
  return queryRow<PolicyBundleRow>(
    `SELECT pb.id, pb.id AS bundle_id, pb.tenant_code, pbt.deployment_id, pb.bundle_version, pb.bundle_hash, pb.bundle_uri,
            pb.bundle_payload_json, pb.signature, pb.signed_by_kid, pb.signed_at,
            pb.schema_version, pb.issued_at, pb.expires_at, pb.status, pb.created_at
     FROM (
       SELECT MAX(pbt.bundle_id) AS bundle_id
       FROM policy_bundle_targets pbt
       INNER JOIN policy_bundles pb2 ON pb2.id = pbt.bundle_id
       WHERE pbt.deployment_id = ?
         AND pb2.status = 'active'
         AND (pb2.expires_at IS NULL OR pb2.expires_at > UTC_TIMESTAMP())
     ) latest
     INNER JOIN policy_bundles pb ON pb.id = latest.bundle_id
     INNER JOIN policy_bundle_targets pbt
       ON pbt.bundle_id = pb.id
      AND pbt.deployment_id = ?
     WHERE latest.bundle_id IS NOT NULL`,
    [deploymentId, deploymentId]
  )
}

export async function findLatestRevocationSnapshot(deploymentId: number) {
  return queryRow<RevocationSnapshotRow>(
    `SELECT rs.id, rs.id AS snapshot_id, rs.tenant_code, rst.deployment_id, rs.snapshot_version, rs.snapshot_hash, rs.snapshot_uri,
            rs.issued_at, rs.status, rs.created_at
     FROM revocation_snapshot_targets rst
     INNER JOIN revocation_snapshots rs ON rs.id = rst.snapshot_id
     WHERE rst.deployment_id = ?
       AND rs.status = 'active'
     ORDER BY rs.issued_at DESC, rs.id DESC
     LIMIT 1`,
    [deploymentId]
  )
}

export async function findEffectiveManifestByAppCode(appCode: string) {
  const linkedManifest = await queryRow<PlatformManifestRow>(
    `SELECT pam.app_code, pam.manifest_seq, pam.manifest_hash, pam.manifest_json, pam.created_at
     FROM platform_applications pa
     INNER JOIN platform_app_manifests pam
       ON pam.id = pa.latest_manifest_id
      AND pam.app_code = pa.app_code
     WHERE pa.app_code = ?
       AND pa.status = 'active'
     LIMIT 1`,
    [appCode]
  )

  if (linkedManifest) {
    return linkedManifest
  }

  return queryRow<PlatformManifestRow>(
    `SELECT app_code, manifest_seq, manifest_hash, manifest_json, created_at
     FROM platform_app_manifests
     WHERE app_code = ?
       AND status = 'active'
     ORDER BY manifest_seq DESC, id DESC
     LIMIT 1`,
    [appCode]
  )
}
