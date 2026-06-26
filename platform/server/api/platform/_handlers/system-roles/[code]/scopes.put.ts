import type { H3Event } from 'h3'
import { ok } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'
import {
  loadSystemRoleId,
  replaceSystemRoleScopes,
  type SystemScopeInput
} from '~~/server/utils/systemRoleGovernance'

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
  const scopes = Array.isArray(body.scopes)
    ? body.scopes as SystemScopeInput[]
    : []

  const result = await withTransaction(async (tx) => {
    const roleId = await loadSystemRoleId(tx, code)
    const items = await replaceSystemRoleScopes(tx, roleId, scopes)
    return { roleId, items }
  })

  return ok({
    roleCode: code,
    roleId: result.roleId,
    items: result.items,
    total: result.items.length
  })
})
