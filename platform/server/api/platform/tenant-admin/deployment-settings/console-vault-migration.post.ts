import { randomUUID } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { getHeader, getRequestIP } from 'h3'
import { ok } from '~~/server/utils/api'
import { queryRow, withTransaction } from '~~/server/utils/db'
import {
  loadConsoleVaultMasterKeyForMigration,
  retireConsoleVaultMasterKeyAfterMigration
} from '~~/server/utils/deploymentBootstrapSecrets'
import { sign } from '~~/server/utils/platformSigning'
import { requireTenantOwnerForTenantAdmin } from '~~/server/utils/tenantAdminAccess'
import { normalizeDeploymentEnvironment } from '~~/server/utils/tenantDeploymentSettings'

interface ConsoleMigrationTargetRow extends RowDataPacket {
  deployment_id: number
  deployment_code: string
  runtime_code: string
  runtime_endpoint: string
  runtime_status: string
}

async function runtimeRejectionCode(response: Response) {
  try {
    const text = await response.text()
    const body = JSON.parse(text) as {
      error?: { code?: unknown }
    }
    const code = String(body?.error?.code || '').trim()
    return /^[a-z0-9_]{1,100}$/.test(code) ? code : ''
  } catch {
    return ''
  }
}

function assertSafeRuntimeEndpoint(value: string) {
  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch {
    throw createError({ statusCode: 409, message: 'Tenant Runtime endpoint is invalid' })
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw createError({ statusCode: 409, message: 'Tenant Runtime endpoint must be an HTTPS URL without credentials' })
  }
  const hostname = endpoint.hostname.toLowerCase()
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || /^(?:127|10|0)\./.test(hostname)
    || /^169\.254\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname)
    || hostname === '::1'
  ) {
    throw createError({ statusCode: 409, message: 'Tenant Runtime endpoint must not target a loopback or private address' })
  }
  endpoint.pathname = '/runtime/bootstrap/console-vault-master-key'
  endpoint.search = ''
  endpoint.hash = ''
  return endpoint
}

export default defineEventHandler(async (event) => {
  requireTenantOwnerForTenantAdmin(event, 'only tenant owner can migrate the Console Vault master key')
  const tenantCode = String(event.context.platformTenantCode || '').trim()
  if (!tenantCode) {
    throw createError({ statusCode: 400, message: 'tenant context is missing' })
  }
  const body = await readBody<Record<string, unknown>>(event)
  const environment = normalizeDeploymentEnvironment(body?.environment)
  const target = await queryRow<ConsoleMigrationTargetRow>(
    `SELECT d.id AS deployment_id, d.deployment_code,
            i.runtime_code, i.runtime_endpoint, i.status AS runtime_status
     FROM deployments d
     INNER JOIN tenant_runtime_instance_apps a
       ON a.deployment_id = d.id
      AND a.app_code = 'console'
     INNER JOIN tenant_runtime_instances i
       ON i.id = a.runtime_instance_id
      AND i.tenant_code = d.tenant_code
      AND i.environment = d.environment
     WHERE d.tenant_code = ?
       AND d.environment = ?
       AND d.app_code = 'console'
       AND d.status = 'active'
     ORDER BY d.id DESC
     LIMIT 1`,
    [tenantCode, environment]
  )
  if (!target?.runtime_endpoint) {
    throw createError({ statusCode: 409, message: 'enrolled Tenant Runtime with an active Console binding is required' })
  }
  if (!['ready', 'enrolled', 'updating'].includes(target.runtime_status)) {
    throw createError({ statusCode: 409, message: `Tenant Runtime is not ready for migration: ${target.runtime_status}` })
  }
  const secret = await loadConsoleVaultMasterKeyForMigration(target.deployment_id)
  if (secret.status === 'migrated') {
    return ok({
      status: 'already_migrated',
      tenantCode,
      environment,
      runtimeCode: target.runtime_code,
      deploymentCode: target.deployment_code,
      vaultMasterKeyFingerprint: secret.fingerprint
    })
  }

  const issuedAt = new Date()
  const payload = {
    jti: randomUUID(),
    tenantCode,
    deploymentCode: target.deployment_code,
    runtimeCode: target.runtime_code,
    vaultMasterKey: secret.value,
    vaultMasterKeyFingerprint: secret.fingerprint,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 5 * 60 * 1000).toISOString()
  }
  const payloadJSON = JSON.stringify(payload)
  const signed = await sign(payloadJSON)
  const endpoint = assertSafeRuntimeEndpoint(target.runtime_endpoint)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': `console-vault-migration-${payload.jti}`
      },
      body: JSON.stringify({
        schemaVersion: 'console-vault-bootstrap.v1',
        payload: Buffer.from(payloadJSON).toString('base64url'),
        signature: signed.signature,
        kid: signed.kid,
        alg: signed.alg
      }),
      signal: AbortSignal.timeout(15_000)
    })
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: 'Tenant Runtime Console Vault migration endpoint is unavailable'
    })
  }
  if (!response.ok) {
    const rejectionCode = await runtimeRejectionCode(response)
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: `Tenant Runtime rejected Console Vault migration with HTTP ${response.status}${rejectionCode ? ` (${rejectionCode})` : ''}`
    })
  }
  const runtimeResult = await response.json() as Record<string, unknown>
  if (
    runtimeResult.tenantCode !== tenantCode
    || runtimeResult.deploymentCode !== target.deployment_code
    || runtimeResult.runtimeCode !== target.runtime_code
    || runtimeResult.vaultMasterKeyFingerprint !== secret.fingerprint
    || !['imported', 'already_present'].includes(String(runtimeResult.status || ''))
  ) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: 'Tenant Runtime returned an invalid Console Vault migration receipt'
    })
  }

  const accountId = Number(event.context.platformAccountId || 0) || null
  const operatorUid = String(event.context.platformUid || '').trim() || null
  await withTransaction(async (tx) => {
    await retireConsoleVaultMasterKeyAfterMigration({
      secretId: secret.secretId,
      expectedValue: secret.value,
      fingerprint: secret.fingerprint,
      executor: tx
    })
    await tx.execute<ResultSetHeader>(
      `INSERT INTO tenant_audit_logs
        (tenant_code, operator_account_id, operator_uid, target_type, target_id,
         action, before_json, after_json, source, ip, user_agent, created_at)
       VALUES (?, ?, ?, 'tenant_runtime', ?, 'console.vault_master_key.migrate',
         CAST(? AS JSON), CAST(? AS JSON), 'platform',
         ?, ?, UTC_TIMESTAMP())`,
      [
        tenantCode,
        accountId,
        operatorUid,
        target.runtime_code,
        JSON.stringify({ custody: 'platform_bootstrap_secret' }),
        JSON.stringify({
          custody: 'tenant_runtime',
          deploymentCode: target.deployment_code,
          fingerprint: secret.fingerprint
        }),
        getRequestIP(event, { xForwardedFor: true }) || null,
        String(getHeader(event, 'user-agent') || '').slice(0, 500) || null
      ]
    )
  })

  return ok({
    status: 'migrated',
    tenantCode,
    environment,
    runtimeCode: target.runtime_code,
    deploymentCode: target.deployment_code,
    vaultMasterKeyFingerprint: secret.fingerprint
  })
})
