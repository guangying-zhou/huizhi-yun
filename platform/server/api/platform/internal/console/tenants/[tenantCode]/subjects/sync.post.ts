import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { queryRow } from '~~/server/utils/db'
import {
  applySubjectProjectionSync,
  type SubjectProjectionMembershipItem,
  type SubjectProjectionSyncItem
} from '~~/server/utils/subjectProjectionSync'
import { normalizeDeploymentEnvironment } from '~~/server/utils/tenantDeploymentSettings'

interface ConsoleDeploymentRow extends RowDataPacket {
  id: number
  tenant_code: string
  deployment_code: string
  environment: string
  status: string
}

export default defineEventHandler(async (event) => {
  if (
    event.context.platformAccessScope !== 'internal'
    || event.context.platformInternalPrincipal !== 'console-managed-cloud-worker'
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'trusted managed Cloud Console principal required'
    })
  }

  const tenantCode = requireString(getRouterParam(event, 'tenantCode'), 'tenantCode')
  const query = getQuery(event)
  const environment = normalizeDeploymentEnvironment(query.environment)
  const deploymentCode = normalizeNullableString(query.deploymentCode || query.deployment_code)
  const deployment = await queryRow<ConsoleDeploymentRow>(
    `SELECT id, tenant_code, deployment_code, environment, status
       FROM deployments
      WHERE tenant_code = ?
        AND app_code = 'console'
        AND environment = ?
        ${deploymentCode ? 'AND deployment_code = ?' : ''}
      ORDER BY status = 'active' DESC, id DESC
      LIMIT 1`,
    deploymentCode ? [tenantCode, environment, deploymentCode] : [tenantCode, environment]
  )

  if (!deployment) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `console deployment not found: tenantCode=${tenantCode}, environment=${environment}`
    })
  }
  if (deployment.status !== 'active') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `console deployment is not active: deploymentCode=${deployment.deployment_code}, status=${deployment.status}`
    })
  }

  const body = await readBody<Record<string, unknown>>(event)
  const result = await applySubjectProjectionSync({
    tenantCode: deployment.tenant_code,
    deploymentId: deployment.id,
    deploymentCode: deployment.deployment_code,
    cursor: body.cursor,
    snapshotHash: body.snapshotHash,
    items: Array.isArray(body.items) ? body.items as SubjectProjectionSyncItem[] : [],
    memberships: Array.isArray(body.memberships) ? body.memberships as SubjectProjectionMembershipItem[] : [],
    resetMemberships: body.resetMemberships,
    finalize: body.finalize
  })

  return ok(result)
})
