import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { queryRow } from '~~/server/utils/db'
import {
  findOrGeneratePolicyBundleForDeployment,
  formatPolicyBundleSignature,
  maybeReturnPolicyBundleNotModified,
  parsePolicyBundlePayload
} from '~~/server/utils/policyBundle'
import { normalizeDeploymentEnvironment } from '~~/server/utils/tenantDeploymentSettings'

interface ConsoleDeploymentRow extends RowDataPacket {
  id: number
  tenant_code: string
  app_code: string
  deployment_code: string
  deployment_name: string
  deployment_mode: string
  environment: string
  status: string
}

async function findConsoleDeployment(input: {
  tenantCode: string
  environment: string
  deploymentCode?: string | null
}) {
  const deploymentCode = normalizeNullableString(input.deploymentCode)
  const deployment = await queryRow<ConsoleDeploymentRow>(
    `SELECT id, tenant_code, app_code, deployment_code, deployment_name,
            deployment_mode, environment, status
       FROM deployments
      WHERE tenant_code = ?
        AND app_code = 'console'
        AND environment = ?
        ${deploymentCode ? 'AND deployment_code = ?' : ''}
      ORDER BY status = 'active' DESC, id DESC
      LIMIT 1`,
    deploymentCode
      ? [input.tenantCode, input.environment, deploymentCode]
      : [input.tenantCode, input.environment]
  )

  if (!deployment) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `console deployment not found: tenantCode=${input.tenantCode}, environment=${input.environment}`
    })
  }

  if (deployment.status !== 'active') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `console deployment is not active: deploymentCode=${deployment.deployment_code}, status=${deployment.status}`
    })
  }

  return deployment
}

export default defineEventHandler(async (event) => {
  const tenantCode = requireString(getRouterParam(event, 'tenantCode'), 'tenantCode')
  const query = getQuery(event)
  const environment = normalizeDeploymentEnvironment(query.environment)
  const deployment = await findConsoleDeployment({
    tenantCode,
    environment,
    deploymentCode: normalizeNullableString(query.deploymentCode || query.deployment_code)
  })
  const bundle = await findOrGeneratePolicyBundleForDeployment({
    deploymentId: deployment.id,
    tenantCode: deployment.tenant_code,
    version: normalizeNullableString(query.version || query.bundleVersion)
  })

  if (!bundle) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `bundle not found: tenantCode=${tenantCode}, deploymentCode=${deployment.deployment_code}`
    })
  }

  if (maybeReturnPolicyBundleNotModified(event, bundle)) {
    return null
  }

  return ok({
    deploymentId: deployment.deployment_code,
    tenantCode: deployment.tenant_code,
    bundleVersion: bundle.bundle_version,
    bundleHash: bundle.bundle_hash,
    generatedAt: bundle.issued_at,
    expiresAt: bundle.expires_at,
    schemaVersion: bundle.schema_version,
    status: bundle.status,
    ...formatPolicyBundleSignature(bundle),
    bundle: parsePolicyBundlePayload(bundle.bundle_payload_json)
  })
})
