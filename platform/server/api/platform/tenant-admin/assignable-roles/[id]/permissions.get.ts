import type { H3Event } from 'h3'
import type { RowDataPacket } from 'mysql2/promise'
import { ok, requireString } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface RoleRow extends RowDataPacket {
  id: number
  tenant_code: string
}

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
  const tenantCode = requireString(getQuery(event).tenantCode, 'tenantCode')

  const role = await queryRow<RoleRow>(
    `SELECT id, tenant_code
     FROM tenant_roles
     WHERE id = ?
       AND tenant_code = ?
     LIMIT 1`,
    [id, tenantCode]
  )

  if (!role) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `assignable role not found: id=${id}`
    })
  }

  const items = await queryRows<PermissionRow[]>(
    `SELECT rp.app_code,
            rp.resource_code,
            COALESCE(source_mr.resource_name, latest_mr.resource_name, rp.resource_code) AS resource_name,
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
     UNION ALL
     SELECT arp.app_code,
            arp.resource_code,
            COALESCE(source_mr2.resource_name, latest_mr2.resource_name, arp.resource_code) AS resource_name,
            arp.action,
            arp.manifest_action_id AS source_manifest_action_id
     FROM tenant_role_app_role_maps tram
     INNER JOIN platform_app_roles ar
       ON ar.role_code = tram.app_role_code
      AND ar.status = 'active'
     INNER JOIN platform_app_role_permissions arp
       ON arp.app_role_id = ar.id
     LEFT JOIN platform_app_manifest_resource_actions source_mra2
       ON source_mra2.id = arp.manifest_action_id
     LEFT JOIN platform_app_manifest_resources source_mr2
       ON source_mr2.id = source_mra2.manifest_resource_id
     LEFT JOIN platform_applications pa2
       ON pa2.app_code = arp.app_code
     LEFT JOIN platform_app_manifest_resources latest_mr2
       ON latest_mr2.app_code = arp.app_code
      AND latest_mr2.manifest_id = pa2.latest_manifest_id
      AND latest_mr2.resource_code = arp.resource_code
     WHERE tram.role_id = ?
       AND tram.tenant_code = ?
     ORDER BY app_code ASC, resource_code ASC, action ASC`,
    [id, tenantCode, id, tenantCode]
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
