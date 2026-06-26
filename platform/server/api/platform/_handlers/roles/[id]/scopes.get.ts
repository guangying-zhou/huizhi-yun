import type { H3Event } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface ScopeRow extends RowDataPacket {
  app_code: string
  resource_code: string
  resource_name: string | null
  action: string
  scope_type: string
  scope_value: string
  status: string
  source_manifest_action_id: number | null
}

function requireId(event: H3Event) {
  const raw = getRouterParam(event, 'id')
  const id = Number(raw)
  if (!raw || Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'id is invalid'
    })
  }

  return id
}

export default defineEventHandler(async (event) => {
  const id = requireId(event)

  const role = await queryRow<RowDataPacket>(
    `SELECT id, tenant_code
     FROM tenant_roles
     WHERE id = ?
     LIMIT 1`,
    [id]
  )

  if (!role || !role.tenant_code) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `tenant role not found: id=${id}`
    })
  }

  const items = await queryRows<ScopeRow[]>(
    `SELECT rs.app_code,
            rs.resource_code,
            COALESCE(source_mr.resource_name, latest_mr.resource_name) AS resource_name,
            rs.action,
            rs.scope_type,
            rs.scope_value,
            rs.status,
            rs.source_manifest_action_id
     FROM tenant_role_scopes rs
     LEFT JOIN platform_app_manifest_resource_actions source_mra
       ON source_mra.id = rs.source_manifest_action_id
     LEFT JOIN platform_app_manifest_resources source_mr
       ON source_mr.id = source_mra.manifest_resource_id
     LEFT JOIN platform_applications pa
       ON pa.app_code = rs.app_code
     LEFT JOIN platform_app_manifest_resources latest_mr
       ON latest_mr.app_code = rs.app_code
      AND latest_mr.manifest_id = pa.latest_manifest_id
      AND latest_mr.resource_code = rs.resource_code
     WHERE rs.role_id = ?
       AND rs.tenant_code = ?
     ORDER BY rs.app_code ASC, rs.resource_code ASC, rs.action ASC, rs.scope_type ASC, rs.scope_value ASC`,
    [id, role.tenant_code]
  )

  return ok({
    roleId: id,
    tenantCode: role.tenant_code,
    items: items.map(item => ({
      appCode: item.app_code,
      resourceCode: item.resource_code,
      resourceName: item.resource_name || item.resource_code,
      action: item.action,
      scopeType: item.scope_type,
      scopeValue: item.scope_value,
      status: item.status,
      sourceManifestActionId: item.source_manifest_action_id
    }))
  })
})
