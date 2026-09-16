import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { withTransaction } from '~~/server/utils/db'

export const TENANT_RUNTIME_APPS = [
  { appCode: 'aims', envPrefix: 'AIMS' },
  { appCode: 'altoc', envPrefix: 'ALTOC' },
  { appCode: 'assets', envPrefix: 'ASSETS' },
  { appCode: 'codocs', envPrefix: 'CODOCS' },
  { appCode: 'finance', envPrefix: 'FINANCE' },
  { appCode: 'people', envPrefix: 'PEOPLE' },
  { appCode: 'workflow', envPrefix: 'WORKFLOW' },
  { appCode: 'webdev', envPrefix: 'WEBDEV' }
] as const

// Console and Directory share the Console deployment binding. The install
// command enables the Console adapter explicitly because its environment key is
// HZY_CONSOLE_RUNTIME_ENABLED rather than the business-adapter *_AGENT_ENABLED
// naming convention below.
export const TENANT_RUNTIME_BINDING_APP_CODES = [
  'console',
  ...TENANT_RUNTIME_APPS.map(item => item.appCode)
] as const

interface RuntimeInstanceRow extends RowDataPacket {
  id: number
  runtime_code: string
  tenant_code: string
  environment: string
  desired_version: string
  release_signing_key_id: string
  control_token_hash: string | null
  runtime_endpoint: string | null
}

interface EnrollmentRow extends RuntimeInstanceRow {
  enrollment_id: number
  code_hash: string
  enrollment_status: string
  expires_at: string
}

interface BindingRow extends RowDataPacket {
  app_code: string
  deployment_code: string
}

export function hashTenantRuntimeSecret(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function safeHashEquals(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function runtimeCode(tenantCode: string, environment: string) {
  return `${tenantCode}-${environment}-tenant-runtime`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
}

export async function issueTenantRuntimeEnrollment(input: {
  tenantCode: string
  environment: string
  desiredVersion: string
  releaseSigningKeyId: string
  runtimeEndpoint?: string | null
  ttlSeconds: number
  issuedByAccountId?: number | null
}) {
  const code = `hzy_enr_${randomBytes(32).toString('base64url')}`
  const codeHash = hashTenantRuntimeSecret(code)
  const codeLast4 = code.slice(-4)
  const instanceCode = runtimeCode(input.tenantCode, input.environment)

  return await withTransaction(async (tx) => {
    await tx.execute<ResultSetHeader>(
      `INSERT INTO tenant_runtime_instances
        (runtime_code, tenant_code, environment, status, runtime_endpoint, desired_version, release_signing_key_id,
         created_at, updated_at)
       VALUES (?, ?, ?, 'enrollment_issued', ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         runtime_code = VALUES(runtime_code),
         status = CASE WHEN status IN ('pending', 'enrollment_issued') THEN 'enrollment_issued' ELSE status END,
         runtime_endpoint = COALESCE(VALUES(runtime_endpoint), runtime_endpoint),
         desired_version = VALUES(desired_version),
         release_signing_key_id = VALUES(release_signing_key_id),
         last_error_code = NULL,
         last_error_message = NULL,
         updated_at = UTC_TIMESTAMP()`,
      [instanceCode, input.tenantCode, input.environment, input.runtimeEndpoint || null, input.desiredVersion, input.releaseSigningKeyId]
    )

    const instance = await tx.queryRow<RuntimeInstanceRow>(
      `SELECT id, runtime_code, tenant_code, environment, desired_version,
              release_signing_key_id, control_token_hash, runtime_endpoint
       FROM tenant_runtime_instances
       WHERE tenant_code = ? AND environment = ?
       FOR UPDATE`,
      [input.tenantCode, input.environment]
    )
    if (!instance) throw new Error('failed to materialize tenant runtime instance')

    await tx.execute<ResultSetHeader>(
      `UPDATE tenant_runtime_enrollments
       SET status = 'revoked', revoked_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
       WHERE runtime_instance_id = ? AND status = 'issued'`,
      [instance.id]
    )

    const appCodes = [...TENANT_RUNTIME_BINDING_APP_CODES]
    const placeholders = appCodes.map(() => '?').join(', ')
    const deployments = await tx.queryRows<Array<RowDataPacket & { id: number, app_code: string, deployment_code: string }>>(
      `SELECT id, app_code, deployment_code
       FROM deployments
       WHERE tenant_code = ? AND environment = ? AND status = 'active'
         AND app_code IN (${placeholders})
       ORDER BY app_code`,
      [input.tenantCode, input.environment, ...appCodes]
    )
    if (deployments.length === 0) {
      throw createError({ statusCode: 409, message: 'at least one active tenant-runtime application deployment is required' })
    }

    for (const deployment of deployments) {
      const isControlPlaneBinding = deployment.app_code === 'console'
      await tx.execute<ResultSetHeader>(
        `INSERT INTO tenant_runtime_instance_apps
          (runtime_instance_id, deployment_id, app_code, status, schema_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE
           deployment_id = VALUES(deployment_id),
           status = CASE WHEN VALUES(app_code) = 'console' THEN VALUES(status) ELSE status END,
           schema_status = CASE WHEN VALUES(app_code) = 'console' THEN VALUES(schema_status) ELSE schema_status END,
           updated_at = UTC_TIMESTAMP()`,
        [
          instance.id,
          deployment.id,
          deployment.app_code,
          isControlPlaneBinding ? 'schema_ready' : 'pending',
          isControlPlaneBinding ? 'not_applicable' : 'unknown'
        ]
      )
    }

    await tx.execute<ResultSetHeader>(
      `INSERT INTO tenant_runtime_enrollments
        (runtime_instance_id, code_hash, code_last4, status, expires_at, issued_by_account_id,
         created_at, updated_at)
       VALUES (?, ?, ?, 'issued', DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [instance.id, codeHash, codeLast4, input.ttlSeconds, input.issuedByAccountId || null]
    )

    return {
      instanceId: instance.id,
      runtimeCode: instance.runtime_code,
      code,
      codeLast4,
      enabledApps: deployments.filter(item => item.app_code !== 'console').map(item => item.app_code),
      deploymentBindings: Object.fromEntries(deployments.map(item => [item.app_code, item.deployment_code]))
    }
  })
}

export async function redeemTenantRuntimeEnrollment(input: {
  code: string
  runtimeCode: string
  runtimeVersion: string
  releaseSigningKeyId: string
  runtimeEndpoint?: string | null
}) {
  const codeHash = hashTenantRuntimeSecret(input.code)
  return await withTransaction(async (tx) => {
    const row = await tx.queryRow<EnrollmentRow>(
      `SELECT e.id AS enrollment_id, e.code_hash, e.status AS enrollment_status, e.expires_at,
              i.id, i.runtime_code, i.tenant_code, i.environment, i.desired_version,
              i.release_signing_key_id, i.control_token_hash, i.runtime_endpoint
       FROM tenant_runtime_enrollments e
       INNER JOIN tenant_runtime_instances i ON i.id = e.runtime_instance_id
       WHERE e.code_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [codeHash]
    )

    if (!row || !safeHashEquals(row.code_hash, codeHash)) {
      throw createError({ statusCode: 401, message: 'invalid or expired tenant runtime enrollment code' })
    }
    if (row.enrollment_status !== 'issued') {
      throw createError({ statusCode: 409, message: `tenant runtime enrollment is ${row.enrollment_status}` })
    }
    if (new Date(`${row.expires_at.replace(' ', 'T')}Z`).getTime() <= Date.now()) {
      await tx.execute<ResultSetHeader>(
        `UPDATE tenant_runtime_enrollments SET status = 'expired', last_error_code = 'enrollment_expired', updated_at = UTC_TIMESTAMP() WHERE id = ?`,
        [row.enrollment_id]
      )
      throw createError({ statusCode: 410, message: 'tenant runtime enrollment code has expired' })
    }
    if (row.runtime_code !== input.runtimeCode) {
      await tx.execute<ResultSetHeader>(
        `UPDATE tenant_runtime_enrollments SET attempt_count = attempt_count + 1, last_error_code = 'enrollment_binding_mismatch', updated_at = UTC_TIMESTAMP() WHERE id = ?`,
        [row.enrollment_id]
      )
      throw createError({ statusCode: 403, message: 'tenant runtime enrollment binding mismatch' })
    }
    if (row.desired_version !== input.runtimeVersion) {
      throw createError({ statusCode: 409, message: 'tenant runtime enrollment version mismatch' })
    }
    if (row.release_signing_key_id !== input.releaseSigningKeyId) {
      throw createError({ statusCode: 403, message: 'tenant runtime enrollment release key mismatch' })
    }
    if (row.runtime_endpoint && input.runtimeEndpoint && row.runtime_endpoint !== input.runtimeEndpoint) {
      throw createError({ statusCode: 403, message: 'tenant runtime endpoint binding mismatch' })
    }

    const runtimeToken = `hzy_dr_${randomBytes(32).toString('base64url')}`
    const controlToken = `hzy_ctl_${randomBytes(32).toString('base64url')}`
    await tx.execute<ResultSetHeader>(
      `UPDATE tenant_runtime_instances
       SET status = CASE WHEN status = 'ready' THEN 'ready' ELSE 'enrolled' END,
           runtime_endpoint = COALESCE(runtime_endpoint, ?),
           runtime_token_hash = ?, runtime_token_last4 = ?,
           control_token_hash = ?, control_token_last4 = ?,
           enrolled_at = UTC_TIMESTAMP(), last_error_code = NULL, last_error_message = NULL,
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        input.runtimeEndpoint || null,
        hashTenantRuntimeSecret(runtimeToken), runtimeToken.slice(-4),
        hashTenantRuntimeSecret(controlToken), controlToken.slice(-4),
        row.id
      ]
    )
    await tx.execute<ResultSetHeader>(
      `UPDATE tenant_runtime_enrollments
       SET status = 'redeemed', redeemed_at = UTC_TIMESTAMP(), attempt_count = attempt_count + 1,
           last_error_code = NULL, updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [row.enrollment_id]
    )

    const bindings = await tx.queryRows<BindingRow[]>(
      `SELECT a.app_code, d.deployment_code
       FROM tenant_runtime_instance_apps a
       INNER JOIN deployments d ON d.id = a.deployment_id
       WHERE a.runtime_instance_id = ?
       ORDER BY a.app_code`,
      [row.id]
    )

    return {
      runtimeCode: row.runtime_code,
      tenantCode: row.tenant_code,
      environment: row.environment,
      desiredVersion: row.desired_version,
      releaseSigningKeyId: row.release_signing_key_id,
      runtimeToken,
      controlToken,
      deploymentBindings: Object.fromEntries(bindings.map(item => [item.app_code, item.deployment_code]))
    }
  })
}
