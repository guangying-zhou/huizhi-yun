import { randomBytes } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { execute, queryRow, queryRows } from '~~/server/utils/db'
import { normalizeDeploymentEnvironment } from '~~/server/utils/tenantDeploymentSettings'

interface ExistingSecretRow extends RowDataPacket {
  deployment_id: number
  deployment_code: string
  environment: string
  secret_value: string
  secret_last4: string | null
}

interface DeploymentRow extends RowDataPacket {
  id: number
  deployment_code: string
  app_code: string
  environment: string
}

const DATA_RUNTIME_STATIC_TOKEN_SECRET_CODE = 'data-runtime.static_token'
const INSTALL_SCRIPT_URL = 'https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh'
const DATA_RUNTIME_APPS = [
  { appCode: 'aims', envPrefix: 'AIMS' },
  { appCode: 'altoc', envPrefix: 'ALTOC' },
  { appCode: 'assets', envPrefix: 'ASSETS' },
  { appCode: 'codocs', envPrefix: 'CODOCS' },
  { appCode: 'finance', envPrefix: 'FINANCE' },
  { appCode: 'people', envPrefix: 'PEOPLE' },
  { appCode: 'workflow', envPrefix: 'WORKFLOW' },
  { appCode: 'webdev', envPrefix: 'WEBDEV' }
] as const

function generateDataRuntimeStaticToken() {
  return `hzy_dr_${randomBytes(32).toString('base64url')}`
}

function tokenLast4(value: string) {
  return value.slice(-4)
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function findExistingSecret(tenantCode: string, environment: string) {
  return await queryRow<ExistingSecretRow>(
    `SELECT s.deployment_id, d.deployment_code, d.environment, s.secret_value, s.secret_last4
     FROM deployment_bootstrap_secrets s
     INNER JOIN deployments d ON d.id = s.deployment_id
     WHERE s.tenant_code = ?
       AND d.environment = ?
       AND s.secret_code = ?
       AND s.status = 'active'
     ORDER BY s.id DESC
     LIMIT 1`,
    [tenantCode, environment, DATA_RUNTIME_STATIC_TOKEN_SECRET_CODE]
  )
}

async function findPreferredDeployment(tenantCode: string, environment: string) {
  return await queryRow<DeploymentRow>(
    `SELECT d.id, d.deployment_code, d.app_code, d.environment
     FROM deployments d
     LEFT JOIN platform_applications pa ON pa.app_code = d.app_code
     WHERE d.tenant_code = ?
       AND d.environment = ?
       AND d.status = 'active'
     ORDER BY
       CASE
         WHEN pa.service_role = 'business_app' THEN 0
         WHEN d.app_code IN ('finance', 'workflow') THEN 1
         WHEN d.app_code = 'console' THEN 3
         ELSE 2
       END,
       d.id ASC
     LIMIT 1`,
    [tenantCode, environment]
  )
}

async function findEnabledDataRuntimeApps(tenantCode: string, environment: string) {
  const appCodes = DATA_RUNTIME_APPS.map(item => item.appCode)
  const placeholders = appCodes.map(() => '?').join(', ')
  const rows = await queryRows<DeploymentRow[]>(
    `SELECT DISTINCT d.app_code
     FROM deployments d
     WHERE d.tenant_code = ?
       AND d.environment = ?
       AND d.status = 'active'
       AND d.app_code IN (${placeholders})`,
    [tenantCode, environment, ...appCodes]
  )

  return new Set(rows.map(row => row.app_code))
}

function installCommand(input: {
  tenantCode: string
  deploymentCode: string
  token: string
  enabledApps: Set<string>
}) {
  const appFlagLines = DATA_RUNTIME_APPS.map((app) => {
    const enabled = input.enabledApps.has(app.appCode) ? 'true' : 'false'
    return `    HZY_${app.envPrefix}_AGENT_ENABLED=${enabled} \\`
  })

  return [
    `curl -fsSL ${INSTALL_SCRIPT_URL} | \\`,
    '  sudo env \\',
    `    HZY_DATA_RUNTIME_TENANT=${shellQuote(input.tenantCode)} \\`,
    `    HZY_DATA_RUNTIME_DEPLOYMENT=${shellQuote(input.deploymentCode)} \\`,
    ...appFlagLines,
    `    HZY_DATA_RUNTIME_STATIC_TOKEN=${shellQuote(input.token)} \\`,
    '    bash'
  ].join('\n')
}

export default defineEventHandler(async (event) => {
  const tenantCode = String(event.context.platformTenantCode || '').trim()
  const membership = event.context.platformTenantMembership
  if (!tenantCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenant context is missing'
    })
  }

  if (!membership?.isOwner) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'only tenant owner can generate data runtime install command'
    })
  }

  const body = await readBody<Record<string, unknown> | null>(event).catch(() => null)
  const environment = normalizeDeploymentEnvironment(body?.environment || getQuery(event).environment)
  const rotate = body?.rotate === true
  const existing = rotate ? null : await findExistingSecret(tenantCode, environment)
  const enabledApps = await findEnabledDataRuntimeApps(tenantCode, environment)
  let token = existing?.secret_value || ''
  let deploymentId = Number(existing?.deployment_id || 0)
  let deploymentCode = String(existing?.deployment_code || '').trim()

  if (!token || !deploymentId || !deploymentCode) {
    const deployment = await findPreferredDeployment(tenantCode, environment)
    if (!deployment) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: 'active deployment is required before generating the Data Runtime install command'
      })
    }

    deploymentId = deployment.id
    deploymentCode = deployment.deployment_code
    token = generateDataRuntimeStaticToken()

    await execute<ResultSetHeader>(
      `UPDATE deployment_bootstrap_secrets
       SET status = 'revoked', updated_at = UTC_TIMESTAMP()
       WHERE tenant_code = ?
         AND secret_code = ?
         AND deployment_id = ?
         AND status = 'active'`,
      [tenantCode, DATA_RUNTIME_STATIC_TOKEN_SECRET_CODE, deploymentId]
    )

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
        deploymentId,
        tenantCode,
        deployment.app_code,
        DATA_RUNTIME_STATIC_TOKEN_SECRET_CODE,
        token,
        tokenLast4(token)
      ]
    )
  }

  return ok({
    tenantCode,
    environment,
    deploymentCode,
    tokenLast4: tokenLast4(token),
    rotated: rotate || !existing,
    enabledApps: [...enabledApps].sort(),
    command: installCommand({
      tenantCode,
      deploymentCode,
      token,
      enabledApps
    })
  })
})
