import type { H3Event } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { queryRow } from '~~/server/utils/db'
import { normalizeNullableString, requireString } from '~~/server/utils/api'
import { findDeploymentByCode, parseStoredJson, type TenantScopedDeploymentRow } from '~~/server/utils/platform'

export function contractOk<T>(data: T) {
  return {
    code: 0,
    data
  }
}

export function notImplemented(message: string) {
  throw createError({
    statusCode: 501,
    statusMessage: 'Not Implemented',
    message
  })
}

export function requireDeploymentCode(value: unknown) {
  return requireString(value, 'deploymentId')
}

export async function findDeploymentForV1(input: {
  deploymentId?: unknown
  deploymentCode?: unknown
  tenantCode?: unknown
}) {
  const deploymentCode = requireDeploymentCode(input.deploymentId || input.deploymentCode)
  const tenantCode = normalizeNullableString(input.tenantCode)
  return findDeploymentByCode(deploymentCode, tenantCode)
}

function getRuntimeDeploymentFromContext(event: H3Event) {
  const runtimeContext = event.context.platformRuntime as { deployment?: TenantScopedDeploymentRow | null } | undefined
  const deployment = event.context.deployment as TenantScopedDeploymentRow | undefined
  return runtimeContext?.deployment || deployment || null
}

export async function resolveDeploymentForV1(event: H3Event, input: {
  deploymentId?: unknown
  deploymentCode?: unknown
  tenantCode?: unknown
}) {
  const deploymentCode = requireDeploymentCode(input.deploymentId || input.deploymentCode)
  const tenantCode = normalizeNullableString(input.tenantCode)
  const contextDeployment = getRuntimeDeploymentFromContext(event)

  if (contextDeployment) {
    if (
      contextDeployment.deployment_code !== deploymentCode
      || (tenantCode && contextDeployment.tenant_code !== tenantCode)
    ) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        message: 'runtime deployment context mismatch'
      })
    }

    return contextDeployment
  }

  return findDeploymentByCode(deploymentCode, tenantCode)
}

interface BundlePayloadRow extends RowDataPacket {
  tenant_code: string
  deployment_id: number
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
}

interface RevocationPayloadRow extends RowDataPacket {
  tenant_code: string
  deployment_id: number
  snapshot_version: string
  snapshot_hash: string
  entries_json: unknown
  snapshot_uri: string
  signature: string | null
  signed_by_kid: string | null
  issued_at: string
  status: string
}

export async function findBundleVersionForDeployment(bundleVersion: string, deploymentId: number) {
  return queryRow<BundlePayloadRow>(
    `SELECT pb.tenant_code, pbt.deployment_id, pb.bundle_version, pb.bundle_hash,
            pb.bundle_payload_json, pb.bundle_uri, pb.signature, pb.signed_by_kid,
            pb.signed_at, pb.schema_version, pb.issued_at, pb.expires_at, pb.status
     FROM policy_bundle_targets pbt
     INNER JOIN policy_bundles pb ON pb.id = pbt.bundle_id
     WHERE pbt.deployment_id = ?
       AND pb.bundle_version = ?
       AND pb.status = 'active'
     LIMIT 1`,
    [deploymentId, bundleVersion]
  )
}

export async function findRevocationVersionForDeployment(revocationVersion: string, deploymentId: number) {
  return queryRow<RevocationPayloadRow>(
    `SELECT rs.tenant_code, rst.deployment_id, rs.snapshot_version, rs.snapshot_hash,
            rs.entries_json, rs.snapshot_uri, rs.signature, rs.signed_by_kid,
            rs.issued_at, rs.status
     FROM revocation_snapshot_targets rst
     INNER JOIN revocation_snapshots rs ON rs.id = rst.snapshot_id
     WHERE rst.deployment_id = ?
       AND rs.snapshot_version = ?
       AND rs.status = 'active'
     LIMIT 1`,
    [deploymentId, revocationVersion]
  )
}

export function parseBundlePayload(value: unknown) {
  return parseStoredJson<Record<string, unknown>>(value) || {}
}

export function parseRevocationEntries(value: unknown) {
  const parsed = parseStoredJson<unknown[]>(value)
  return Array.isArray(parsed) ? parsed : []
}

export function buildQueryString(params: Record<string, string>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value)
    }
  }

  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}
