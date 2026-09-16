import { defineEventHandler, createError, getRouterParam } from 'h3'
import { queryRows } from '../../../utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface RoleRow extends RowDataPacket {
  id: number
  role_code: string
  role_name: string
}

interface PermissionRow extends RowDataPacket {
  resource_id: number
  action: 'view' | 'edit' | 'admin'
  resource_code: string
  resource_name: string
  app_code: string
  app_name: string
  app_id: number
}

export default defineEventHandler(async (event) => {
  const roleId = Number(getRouterParam(event, 'id'))
  if (!roleId || isNaN(roleId)) {
    throw createError({ statusCode: 400, message: '无效的角色ID' })
  }

  // Check if role exists
  const roles = await queryRows<RoleRow[]>(
    'SELECT id, role_code, role_name FROM roles WHERE id = ?',
    [roleId]
  )
  if (roles.length === 0) {
    throw createError({ statusCode: 404, message: '角色不存在' })
  }
  const role = roles[0]!

  // Get all permissions of this role (these are available for sub-roles)
  const permissions = await queryRows<PermissionRow[]>(`
    SELECT 
      rp.resource_id, rp.action,
      r.resource_code, r.resource_name,
      a.app_code, a.app_name, a.id as app_id
    FROM role_permissions rp
    JOIN resources r ON rp.resource_id = r.id
    JOIN applications a ON r.app_id = a.id
    WHERE rp.role_id = ?
    ORDER BY a.app_code, r.sort_order, rp.action
  `, [roleId])

  // Group by app -> resource -> actions
  const apps: Record<string, {
    appId: number
    appCode: string
    appName: string
    resources: Record<string, {
      resourceId: number
      resourceCode: string
      resourceName: string
      actions: ('view' | 'edit' | 'admin')[]
    }>
  }> = {}

  for (const perm of permissions) {
    if (!apps[perm.app_code]) {
      apps[perm.app_code] = {
        appId: perm.app_id,
        appCode: perm.app_code,
        appName: perm.app_name,
        resources: {}
      }
    }
    if (!apps[perm.app_code]!.resources[perm.resource_code]) {
      apps[perm.app_code]!.resources[perm.resource_code] = {
        resourceId: perm.resource_id,
        resourceCode: perm.resource_code,
        resourceName: perm.resource_name,
        actions: []
      }
    }
    apps[perm.app_code]!.resources[perm.resource_code]!.actions.push(perm.action)
  }

  // Convert to array
  const result = Object.values(apps).map(app => ({
    ...app,
    resources: Object.values(app.resources)
  }))

  return {
    success: true,
    data: {
      parentRole: {
        id: role.id,
        roleCode: role.role_code,
        roleName: role.role_name
      },
      availablePermissions: result
    }
  }
})
