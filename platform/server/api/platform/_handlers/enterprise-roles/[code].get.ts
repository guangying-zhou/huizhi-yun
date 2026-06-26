import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow, queryRows } from '~~/server/utils/db'

interface RoleRow extends RowDataPacket {
  id: number
  role_code: string
  role_name: string
  role_type: string
  description: string | null
  is_required: number
  sort_order: number
  status: string
  policy_revision: number
  policy_hash: string | null
  policy_updated_at: string | null
}

interface AppRoleMapRow extends RowDataPacket {
  app_role_code: string
  app_code: string
  role_name: string
  permission_count: number
  sort_order: number
}

function requireCode(event: Parameters<typeof getRouterParam>[0]) {
  const code = getRouterParam(event, 'code')
  if (!code) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'code is required'
    })
  }

  return decodeURIComponent(code)
}

export default defineEventHandler(async (event) => {
  const code = requireCode(event)
  const role = await queryRow<RoleRow>(
    `SELECT id, role_code, role_name, role_type, description, is_required, sort_order,
            status, policy_revision, policy_hash, policy_updated_at
     FROM platform_system_roles
     WHERE role_code = ?
     LIMIT 1`,
    [code]
  )

  if (!role) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `enterprise role not found: roleCode=${code}`
    })
  }

  const appRoles = await queryRows<AppRoleMapRow[]>(
    `SELECT sarm.app_role_code,
            ar.app_code,
            ar.role_name,
            (
              SELECT COUNT(*)
              FROM platform_app_role_permissions arp
              WHERE arp.app_role_id = ar.id
            ) AS permission_count,
            sarm.sort_order
     FROM platform_system_app_role_maps sarm
     INNER JOIN platform_app_roles ar
       ON ar.id = sarm.app_role_id
     WHERE sarm.system_role_id = ?
      AND ar.status = 'active'
      AND ar.app_code <> 'collab'
     ORDER BY sarm.sort_order ASC, ar.app_code ASC, ar.role_code ASC`,
    [role.id]
  )

  return ok({
    role: {
      id: role.id,
      roleCode: role.role_code,
      roleName: role.role_name,
      roleType: role.role_type,
      description: role.description,
      isRequired: Boolean(role.is_required),
      sortOrder: Number(role.sort_order || 0),
      status: role.status,
      policyRevision: Number(role.policy_revision || 0),
      policyHash: role.policy_hash,
      policyUpdatedAt: role.policy_updated_at
    },
    appRoles: appRoles.map(item => ({
      appRoleCode: item.app_role_code,
      appCode: item.app_code,
      roleName: item.role_name,
      permissionCount: Number(item.permission_count || 0),
      sortOrder: Number(item.sort_order || 0)
    }))
  })
})
