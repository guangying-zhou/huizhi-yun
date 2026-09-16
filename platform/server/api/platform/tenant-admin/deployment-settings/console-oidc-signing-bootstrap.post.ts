import { randomUUID } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { getHeader, getRequestIP } from 'h3'
import { ok } from '~~/server/utils/api'
import { queryRow, withTransaction } from '~~/server/utils/db'
import { sign } from '~~/server/utils/platformSigning'
import { requireTenantOwnerForTenantAdmin } from '~~/server/utils/tenantAdminAccess'
import {
  normalizeDeploymentEnvironment,
  parseTenantSettings,
  tenantGatewaySettings,
  tenantPublicUrl
} from '~~/server/utils/tenantDeploymentSettings'

interface ConsoleBootstrapTargetRow extends RowDataPacket {
  deployment_code: string
  runtime_code: string
  runtime_endpoint: string
  runtime_status: string
  settings_json: unknown
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
  endpoint.pathname = '/runtime/bootstrap/console-oidc-signing-key'
  endpoint.search = ''
  endpoint.hash = ''
  return endpoint
}

async function rejectionCode(response: Response) {
  try {
    const body = await response.json() as { error?: { code?: unknown } }
    const code = String(body?.error?.code || '').trim()
    return /^[a-z0-9_]{1,100}$/.test(code) ? code : ''
  } catch {
    return ''
  }
}

export default defineEventHandler(async (event) => {
  requireTenantOwnerForTenantAdmin(event, 'only tenant owner can initialize Tenant Runtime OIDC signing custody')
  const tenantCode = String(event.context.platformTenantCode || '').trim()
  if (!tenantCode) {
    throw createError({ statusCode: 400, message: 'tenant context is missing' })
  }
  const body = await readBody<Record<string, unknown>>(event)
  const environment = normalizeDeploymentEnvironment(body?.environment)
  const target = await queryRow<ConsoleBootstrapTargetRow>(
    `SELECT d.deployment_code, i.runtime_code, i.runtime_endpoint, i.status AS runtime_status,
            t.settings_json
     FROM deployments d
     INNER JOIN tenants t
       ON t.tenant_code = d.tenant_code
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
    throw createError({ statusCode: 409, message: `Tenant Runtime is not ready for OIDC custody cutover: ${target.runtime_status}` })
  }
  const gateway = tenantGatewaySettings(parseTenantSettings(target.settings_json), environment)
  if (!gateway.subdomain) {
    throw createError({ statusCode: 409, message: 'Tenant Gateway subdomain is required for Console OIDC JWT trust' })
  }
  const issuer = tenantPublicUrl(gateway.subdomain)
  const jwksUrl = `${issuer}/.well-known/jwks.json`

  const issuedAt = new Date()
  const payload = {
    jti: randomUUID(),
    tenantCode,
    deploymentCode: target.deployment_code,
    runtimeCode: target.runtime_code,
    reason: 'tenant-runtime-custody-cutover',
    issuer,
    jwksUrl,
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
        'x-request-id': `console-oidc-bootstrap-${payload.jti}`
      },
      body: JSON.stringify({
        schemaVersion: 'console-oidc-signing-bootstrap.v1',
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
      message: 'Tenant Runtime Console OIDC signing bootstrap endpoint is unavailable'
    })
  }
  if (!response.ok) {
    const code = await rejectionCode(response)
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: `Tenant Runtime rejected Console OIDC signing bootstrap with HTTP ${response.status}${code ? ` (${code})` : ''}`
    })
  }
  const runtimeResult = await response.json() as Record<string, unknown>
  const status = String(runtimeResult.status || '')
  const currentKid = String(runtimeResult.currentKid || '')
  if (
    runtimeResult.tenantCode !== tenantCode
    || runtimeResult.deploymentCode !== target.deployment_code
    || runtimeResult.runtimeCode !== target.runtime_code
    || !['rotated', 'generated', 'already_present'].includes(status)
    || !currentKid
    || runtimeResult.issuer !== issuer
    || runtimeResult.jwksUrl !== jwksUrl
    || runtimeResult.jwtTrust !== 'tenant_gateway'
  ) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Bad Gateway',
      message: 'Tenant Runtime returned an invalid Console OIDC signing bootstrap receipt'
    })
  }

  await withTransaction(async (tx) => {
    await tx.execute<ResultSetHeader>(
      `INSERT INTO tenant_audit_logs
        (tenant_code, operator_account_id, operator_uid, target_type, target_id,
         action, before_json, after_json, source, ip, user_agent, created_at)
       VALUES (?, ?, ?, 'tenant_runtime', ?, 'console.oidc_signing_key.bootstrap',
         CAST(? AS JSON), CAST(? AS JSON), 'platform',
         ?, ?, UTC_TIMESTAMP())`,
      [
        tenantCode,
        Number(event.context.platformAccountId || 0) || null,
        String(event.context.platformUid || '').trim() || null,
        target.runtime_code,
        JSON.stringify({ custody: 'legacy_external_reference' }),
        JSON.stringify({
          custody: 'tenant_runtime_vault',
          deploymentCode: target.deployment_code,
          status,
          currentKid,
          previousKid: runtimeResult.previousKid || null,
          jwtTrust: 'tenant_gateway',
          issuer
        }),
        getRequestIP(event, { xForwardedFor: true }) || null,
        String(getHeader(event, 'user-agent') || '').slice(0, 500) || null
      ]
    )
  })

  return ok({
    status,
    tenantCode,
    environment,
    runtimeCode: target.runtime_code,
    deploymentCode: target.deployment_code,
    currentKid,
    previousKid: runtimeResult.previousKid || null,
    jwtTrust: 'tenant_gateway',
    issuer
  })
})
