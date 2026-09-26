import type { RowDataPacket } from 'mysql2/promise'
import { ok, requireString } from '~~/server/utils/api'
import { queryRow, withTransaction } from '~~/server/utils/db'
import { normalizeDeploymentEnvironment } from '~~/server/utils/tenantDeploymentSettings'
import { ConsoleServiceKeyRefusal, registerConsoleServiceKey } from '~~/server/utils/consoleServiceKeys'

interface ConsoleDeploymentRow extends RowDataPacket {
  tenant_code: string
  deployment_code: string
  environment: string
}

// Console registers its own steady service key (R1). Authorized by the Platform
// internal credential in platform-access middleware, like the policy envelope.
// The key only takes effect once signed into this deployment's envelope.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const tenantCode = requireString(getRouterParam(event, 'tenantCode'), 'tenantCode')
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object' || Object.keys(body).sort().join() !== 'deploymentCode,environment,publicKey') {
    throw createError({ statusCode: 400, message: 'Invalid service key registration', data: { code: 'console_service_key_invalid' } })
  }
  const environment = normalizeDeploymentEnvironment(body.environment)
  const deploymentCode = requireString(body.deploymentCode, 'deploymentCode')
  const deployment = await queryRow<ConsoleDeploymentRow>(
    `SELECT tenant_code, deployment_code, environment FROM deployments
      WHERE tenant_code = ? AND app_code = 'console' AND environment = ? AND deployment_code = ? AND status = 'active'
      LIMIT 1`, [tenantCode, environment, deploymentCode])
  if (!deployment) {
    throw createError({ statusCode: 403, message: 'Console deployment is not active', data: { code: 'policy_deployment_inactive' } })
  }
  try {
    const registered = await withTransaction(tx => registerConsoleServiceKey(tx, {
      tenant: deployment.tenant_code, environment: deployment.environment, deployment: deployment.deployment_code
    }, body.publicKey, Date.now()))
    return ok({ deploymentCode: deployment.deployment_code, ...registered })
  } catch (error) {
    if (error instanceof ConsoleServiceKeyRefusal) {
      throw createError({ statusCode: error.code === 'console_service_key_revoked' ? 409 : 400, message: 'Service key refused', data: { code: error.code } })
    }
    if ((error as { code?: string })?.code === 'ER_NO_SUCH_TABLE') {
      throw createError({ statusCode: 503, message: 'Service key storage is not migrated', data: { code: 'console_service_key_not_migrated' } })
    }
    throw createError({ statusCode: 503, message: 'Service key storage unavailable', data: { code: 'console_service_key_unavailable' } })
  }
})
