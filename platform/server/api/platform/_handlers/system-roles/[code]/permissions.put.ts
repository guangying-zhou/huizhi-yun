import type { H3Event } from 'h3'
import { ok } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'
import {
  loadSystemRoleId,
  replaceSystemRolePermissions,
  type SystemPermissionInput
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
  const permissions = Array.isArray(body.permissions)
    ? body.permissions as SystemPermissionInput[]
    : []

  const result = await withTransaction(async (tx) => {
    const roleId = await loadSystemRoleId(tx, code)
    const items = await replaceSystemRolePermissions(tx, roleId, permissions)
    return { roleId, items }
  })

  return ok({
    roleCode: code,
    roleId: result.roleId,
    items: result.items,
    total: result.items.length
  })
})
