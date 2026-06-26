import { randomBytes } from 'node:crypto'
import type { ResultSetHeader } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { execute } from '~~/server/utils/db'
import { findDeploymentByCode } from '~~/server/utils/platform'

const DATA_RUNTIME_STATIC_TOKEN_SECRET_CODE = 'data-runtime.static_token'

function generateDataRuntimeStaticToken() {
  return `hzy_dr_${randomBytes(32).toString('base64url')}`
}

function tokenLast4(value: string) {
  return value.slice(-4)
}

export default defineEventHandler(async (event) => {
  const deploymentCode = requireString(getRouterParam(event, 'deploymentCode'), 'deploymentCode')
  const scopedTenantCode = event.context.platformAccessScope === 'tenant-admin'
    ? normalizeNullableString(event.context.platformTenantCode)
    : normalizeNullableString(getQuery(event).tenantCode)
  const deployment = await findDeploymentByCode(deploymentCode, scopedTenantCode)
  const token = generateDataRuntimeStaticToken()

  await execute<ResultSetHeader>(
    `INSERT INTO deployment_bootstrap_secrets
      (deployment_id, tenant_code, app_code, secret_code, secret_name, secret_value, secret_last4, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Data Runtime static token', ?, ?, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       secret_value = VALUES(secret_value),
       secret_last4 = VALUES(secret_last4),
       status = 'active',
       updated_at = UTC_TIMESTAMP()`,
    [
      deployment.id,
      deployment.tenant_code,
      deployment.app_code,
      DATA_RUNTIME_STATIC_TOKEN_SECRET_CODE,
      token,
      tokenLast4(token)
    ]
  )

  return ok({
    tenantCode: deployment.tenant_code,
    deploymentCode: deployment.deployment_code,
    appCode: deployment.app_code,
    token,
    tokenType: 'Bearer',
    staticTokenLast4: tokenLast4(token),
    installEnv: {
      HZY_DATA_RUNTIME_TENANT: deployment.tenant_code,
      HZY_DATA_RUNTIME_DEPLOYMENT: deployment.deployment_code,
      HZY_DATA_RUNTIME_STATIC_TOKEN: token
    }
  })
})
