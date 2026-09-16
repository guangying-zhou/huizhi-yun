import { createHash } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { queryRow } from '~~/server/utils/db'

const TENANT_RUNTIME_TOKEN_PREFIX = 'hzy_dr_'

interface TenantRuntimeInstanceTokenRow extends RowDataPacket {
  id: number
  runtime_code: string
  tenant_code: string
  environment: string
  status: string
  runtime_token_last4: string | null
}

export type TenantRuntimeInstanceCredential = {
  credentialMode: 'runtime-instance'
  runtimeInstanceId: number
  runtimeCode: string
  tenantCode: string
  environment: string
  runtimeTokenLast4: string | null
  status: string
}

export function isTenantRuntimeInstanceToken(value: unknown) {
  return String(value || '').startsWith(TENANT_RUNTIME_TOKEN_PREFIX)
}

export async function verifyTenantRuntimeInstanceToken(options: {
  tenantCode: string
  token: string
  deploymentId?: number | null
}): Promise<TenantRuntimeInstanceCredential> {
  if (!isTenantRuntimeInstanceToken(options.token)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'invalid tenant runtime instance token'
    })
  }

  const tokenHash = createHash('sha256').update(options.token).digest('hex')
  const deploymentId = Number(options.deploymentId || 0)
  const row = deploymentId > 0
    ? await queryRow<TenantRuntimeInstanceTokenRow>(
        `SELECT i.id,i.runtime_code,i.tenant_code,i.environment,i.status,i.runtime_token_last4
           FROM tenant_runtime_instances i
           INNER JOIN tenant_runtime_instance_apps a ON a.runtime_instance_id=i.id
          WHERE i.tenant_code=? AND i.runtime_token_hash=?
            AND i.status IN ('enrolled','ready','unhealthy')
            AND a.deployment_id=?
          LIMIT 1`,
        [options.tenantCode, tokenHash, deploymentId]
      )
    : await queryRow<TenantRuntimeInstanceTokenRow>(
        `SELECT id,runtime_code,tenant_code,environment,status,runtime_token_last4
           FROM tenant_runtime_instances
          WHERE tenant_code=? AND runtime_token_hash=?
            AND status IN ('enrolled','ready','unhealthy')
          LIMIT 1`,
        [options.tenantCode, tokenHash]
      )

  if (!row) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      message: 'invalid tenant runtime instance token or deployment binding'
    })
  }

  return {
    credentialMode: 'runtime-instance',
    runtimeInstanceId: Number(row.id),
    runtimeCode: row.runtime_code,
    tenantCode: row.tenant_code,
    environment: row.environment,
    runtimeTokenLast4: row.runtime_token_last4,
    status: row.status
  }
}
