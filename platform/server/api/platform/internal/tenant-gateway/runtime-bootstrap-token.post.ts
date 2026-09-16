import { randomUUID } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { ok, requireString } from '~~/server/utils/api'
import { queryRow } from '~~/server/utils/db'
import { exportPubkey, sign } from '~~/server/utils/platformSigning'
import { runtimeBootstrapIssuer } from '~~/server/utils/runtimeBootstrapIssuer'

interface RuntimeBindingRow extends RowDataPacket {
  deployment_code: string
  runtime_code: string
}

function base64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const environment = requireString(body.environment, 'environment')
  const appCode = requireString(body.appCode, 'appCode')

  if (appCode !== 'console') {
    throw createError({ statusCode: 400, message: 'runtime bootstrap is available only for Console' })
  }

  const binding = await queryRow<RuntimeBindingRow>(
    `SELECT d.deployment_code, i.runtime_code
     FROM deployments d
     INNER JOIN tenant_runtime_instances i
       ON i.tenant_code = d.tenant_code
      AND i.environment = d.environment
      AND i.status = 'ready'
     INNER JOIN tenant_runtime_instance_apps a
       ON a.runtime_instance_id = i.id
      AND a.deployment_id = d.id
      AND a.app_code = d.app_code
      AND a.status IN ('schema_ready', 'active')
     WHERE d.tenant_code = ?
       AND d.environment = ?
       AND d.app_code = ?
       AND d.status = 'active'
     ORDER BY d.id DESC
     LIMIT 1`,
    [tenantCode, environment, appCode]
  )
  if (!binding) {
    throw createError({ statusCode: 409, message: 'tenant runtime binding is not ready' })
  }

  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + 90
  let issuer: string
  try {
    const runtimeEnv = event.context.cloudflare?.env || event.context._platform?.cloudflare?.env || event.context.nitro?.env
    issuer = runtimeBootstrapIssuer(
      runtimeEnv?.NUXT_PUBLIC_SERVICE_URL || runtimeEnv?.PLATFORM_SERVICE_URL
      || process.env.NUXT_PUBLIC_SERVICE_URL || process.env.PLATFORM_SERVICE_URL
      || useRuntimeConfig().public?.serviceUrl
    )
  } catch {
    throw createError({ statusCode: 503, message: 'Platform service URL is not configured for Runtime bootstrap' })
  }
  const payload = base64url({
    iss: issuer,
    aud: 'data-runtime-bootstrap',
    sub: 'platform:tenant-gateway',
    jti: randomUUID(),
    iat: now,
    nbf: now - 5,
    exp: expiresAt,
    token_use: 'platform_runtime_bootstrap',
    tenant: tenantCode,
    deployment: binding.deployment_code,
    appCode,
    runtimeCode: binding.runtime_code,
    scope: 'console:service-token:issue'
  })
  const activeKey = await exportPubkey()
  const protectedHeader = base64url({ alg: 'EdDSA', typ: 'JWT', kid: activeKey.kid })
  const protectedUnsigned = `${protectedHeader}.${payload}`
  const protectedSignature = await sign(Buffer.from(protectedUnsigned))
  if (protectedSignature.kid !== activeKey.kid) {
    throw createError({ statusCode: 503, message: 'platform signing key rotated during bootstrap issuance' })
  }

  return ok({
    token: `${protectedUnsigned}.${protectedSignature.signature}`,
    tokenType: 'Bearer',
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    tenantCode,
    deploymentCode: binding.deployment_code,
    appCode,
    runtimeCode: binding.runtime_code
  })
})
