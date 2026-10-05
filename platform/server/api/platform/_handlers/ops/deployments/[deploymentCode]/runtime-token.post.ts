import type { RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { queryRow } from '~~/server/utils/db'
import { findDeploymentByCode } from '~~/server/utils/platform'
import { issueRuntimeToken } from '~~/server/utils/runtimeToken'

interface AccountIdRow extends RowDataPacket {
  id: number
}

function normalizeSqlDateTime(value: unknown) {
  const rawValue = normalizeNullableString(value)
  if (!rawValue) {
    return null
  }

  const date = new Date(rawValue.includes('T') ? rawValue : `${rawValue.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'expiresAt must be a valid datetime'
    })
  }

  return date.toISOString().slice(0, 19).replace('T', ' ')
}

async function findPlatformAccountId(uid: unknown) {
  const normalizedUid = normalizeNullableString(uid)
  if (!normalizedUid) {
    return null
  }

  const row = await queryRow<AccountIdRow>(
    `SELECT id
     FROM platform_accounts
     WHERE uid = ?
     LIMIT 1`,
    [normalizedUid]
  )

  return row?.id || null
}

export default defineEventHandler(async (event) => {
  const deploymentCode = requireString(getRouterParam(event, 'deploymentCode'), 'deploymentCode')
  const body = await readBody<Record<string, unknown> | null>(event).catch(() => null)
  const tenantCode = normalizeNullableString(body?.tenantCode || getQuery(event).tenantCode)
  const expiresAt = normalizeSqlDateTime(body?.expiresAt)
  const deployment = await findDeploymentByCode(deploymentCode, tenantCode)
  const issuedByAccountId = await findPlatformAccountId(event.context.platformUid)
  const issued = await issueRuntimeToken({
    tenantCode: deployment.tenant_code,
    issuedByAccountId,
    expiresAt
  })

  return ok({
    tenantCode: deployment.tenant_code,
    deploymentCode: deployment.deployment_code,
    token: issued.token,
    tokenType: 'Bearer',
    runtimeTokenLast4: issued.tokenLast4,
    credentialMode: issued.credential.credentialMode,
    status: issued.credential.status,
    issuedAt: issued.credential.issuedAt,
    rotatedAt: issued.credential.rotatedAt,
    expiresAt: issued.credential.expiresAt
  })
})
