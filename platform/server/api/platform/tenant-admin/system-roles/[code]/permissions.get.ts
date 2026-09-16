import type { H3Event } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { ok, requireString } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface SystemRoleRow extends RowDataPacket {
  id: number
  role_code: string
  role_name: string
}

interface PermissionRow extends RowDataPacket {
  app_code: string
  resource_code: string
  resource_name: string | null
  action: string
  manifest_action_id: number | null
}

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
  requireString(getQuery(event).tenantCode, 'tenantCode')
  const code = requireCode(event)

  const role = await queryRow<SystemRoleRow>(
    `SELECT id, role_code, role_name
     FROM platform_system_roles
     WHERE role_code = ?
     LIMIT 1`,
    [code]
  )

  if (!role) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `system role not found: roleCode=${code}`
    })
  }

  const items = await queryRows<PermissionRow[]>(
    `SELECT arp.app_code,
            arp.resource_code,
            COALESCE(source_mr.resource_name, latest_mr.resource_name, arp.resource_code) AS resource_name,
            arp.action,
            arp.manifest_action_id
     FROM platform_system_app_role_maps sarm
     INNER JOIN platform_app_roles ar
       ON ar.id = sarm.app_role_id
      AND ar.status = 'active'
     INNER JOIN platform_app_role_permissions arp
       ON arp.app_role_id = ar.id
     LEFT JOIN platform_app_manifest_resource_actions source_mra
       ON source_mra.id = arp.manifest_action_id
     LEFT JOIN platform_app_manifest_resources source_mr
       ON source_mr.id = source_mra.manifest_resource_id
     LEFT JOIN platform_applications pa
       ON pa.app_code = arp.app_code
     LEFT JOIN platform_app_manifest_resources latest_mr
       ON latest_mr.app_code = arp.app_code
      AND latest_mr.manifest_id = pa.latest_manifest_id
      AND latest_mr.resource_code = arp.resource_code
     WHERE sarm.system_role_id = ?
     ORDER BY arp.app_code ASC, arp.resource_code ASC, arp.action ASC`,
    [role.id]
  )

  return ok({
    role: {
      id: role.id,
      roleCode: role.role_code,
      roleName: role.role_name,
      appCode: null
    },
    items: items.map(item => ({
      appCode: item.app_code,
      resourceCode: item.resource_code,
      resourceName: item.resource_name || item.resource_code,
      action: item.action,
      manifestActionId: item.manifest_action_id
    }))
  })
})
