import type { H3Event } from 'h3'
import { ok, requireString } from '~~/server/utils/api'
import { queryRow, queryRows, execute } from '~~/server/utils/db'
import { buildSystemRoleDiff } from '~~/server/utils/tenantSystemRoles'

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
  const tenantCode = requireString(getQuery(event).tenantCode, 'tenantCode')
  const diff = await buildSystemRoleDiff({ queryRow, queryRows, execute }, tenantCode, requireCode(event))
  return ok(diff)
})
