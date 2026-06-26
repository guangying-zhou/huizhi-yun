import type { H3Event } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface PermissionRow extends RowDataPacket {
  app_code: string
  resource_code: string
  resource_name: string | null
  action: string
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

  const items = await queryRows<PermissionRow[]>(
    `SELECT rp.app_code,
            rp.resource_code,
            COALESCE(source_mr.resource_name, latest_mr.resource_name) AS resource_name,
            rp.action,
            rp.source_manifest_action_id
     FROM tenant_role_permissions rp
     LEFT JOIN platform_app_manifest_resource_actions source_mra
       ON source_mra.id = rp.source_manifest_action_id
     LEFT JOIN platform_app_manifest_resources source_mr
       ON source_mr.id = source_mra.manifest_resource_id
     LEFT JOIN platform_applications pa
       ON pa.app_code = rp.app_code
     LEFT JOIN platform_app_manifest_resources latest_mr
       ON latest_mr.app_code = rp.app_code
      AND latest_mr.manifest_id = pa.latest_manifest_id
      AND latest_mr.resource_code = rp.resource_code
     WHERE rp.role_id = ?
       AND rp.tenant_code = ?
     ORDER BY rp.app_code ASC, rp.resource_code ASC, rp.action ASC`,
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
      sourceManifestActionId: item.source_manifest_action_id
    }))
  })
})
