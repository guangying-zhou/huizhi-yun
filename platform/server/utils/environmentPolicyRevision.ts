import { createError } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { requireRuntimeReleaseEnvironment } from './runtimeReleaseEnvironment.ts'

export async function resolveTenantEnvironmentPolicyRevision(
  tx: {
    queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
    execute: <T extends ResultSetHeader>(sql: string, params?: unknown[]) => Promise<T>
  },
  tenantCode: string,
  policyHash: string,
  environment: string,
  forceAdvance = false
) {
  requireRuntimeReleaseEnvironment(environment)
  await tx.execute<ResultSetHeader>(
    `INSERT INTO tenant_environment_policy_revisions
      (tenant_code, environment, policy_revision, policy_hash, policy_updated_at)
     SELECT ?, ?, COALESCE(MAX(policy_revision), 0), NULL, NULL
     FROM policy_bundles WHERE tenant_code = ? AND environment = ?
     ON DUPLICATE KEY UPDATE policy_revision = policy_revision`,
    [tenantCode, environment, tenantCode, environment]
  )

  const current = await tx.queryRow<RowDataPacket & { policyRevision: number, policyHash: string | null }>(
    `SELECT policy_revision AS policyRevision, policy_hash AS policyHash
     FROM tenant_environment_policy_revisions
     WHERE tenant_code = ? AND environment = ?
     LIMIT 1
     FOR UPDATE`,
    [tenantCode, environment]
  )

  const currentRevision = Number(current?.policyRevision)
  if (!current || !Number.isSafeInteger(currentRevision) || currentRevision < 0 || currentRevision >= Number.MAX_SAFE_INTEGER) {
    throw createError({ statusCode: 503, message: 'environment_policy_revision_invalid' })
  }
  if (!forceAdvance && currentRevision > 0 && current?.policyHash === policyHash) {
    return currentRevision
  }

  const nextRevision = currentRevision + 1
  await tx.execute<ResultSetHeader>(
    `UPDATE tenant_environment_policy_revisions
     SET policy_revision = ?,
         policy_hash = ?,
         policy_updated_at = UTC_TIMESTAMP(),
         updated_at = UTC_TIMESTAMP()
     WHERE tenant_code = ? AND environment = ?`,
    [nextRevision, policyHash, tenantCode, environment]
  )

  return nextRevision
}
