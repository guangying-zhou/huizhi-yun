import type { H3Event } from 'h3'
import { ok, requireString } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'
import { materializeSystemRole } from '~~/server/utils/tenantSystemRoles'

function requireCode(event: H3Event) {
  const code = String(getRouterParam(event, 'code') || '').trim()
  if (!code) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'code is required'
    })
  }

  return code
}

export default defineEventHandler(async (event) => {
  const code = requireCode(event)
  const body = await readBody<Record<string, unknown>>(event)
  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const force = body.force === true

  const result = await withTransaction(async (tx) => {
    return materializeSystemRole(tx, {
      tenantCode,
      systemRoleCode: code,
      force
    })
  })

  return ok(result)
})
