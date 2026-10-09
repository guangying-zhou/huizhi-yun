import { defineEventHandler, createError, getRouterParam } from 'h3'
import { queryRows } from '../../../utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface RoleRow extends RowDataPacket {
  id: number
  role_code: string
  role_name: string
  parent_id: number | null
}

interface PermissionRow extends RowDataPacket {
  resource_id: number
  action: 'view' | 'edit' | 'admin'
  resource_code: string
  resource_name: string
  app_code: string
  app_name: string
}

export default defineEventHandler(async (event) => {
  const roleId = Number(getRouterParam(event, 'id'))
  if (!roleId || isNaN(roleId)) {
    throw createError({ statusCode: 400, message: '无效的角色ID' })
  }

  // Check if role exists
  const roles = await queryRows<RoleRow[]>(
    'SELECT id, role_code, role_name, parent_id FROM roles WHERE id = ?',
    [roleId]
  )
  if (roles.length === 0) {
    throw createError({ statusCode: 404, message: '角色不存在' })
  }
  const role = roles[0]!

  // Get permissions
  const permissions = await queryRows<PermissionRow[]>(`
    SELECT 
      rp.resource_id, rp.action,
      r.resource_code, r.resource_name,
      a.app_code, a.app_name
    FROM role_permissions rp
    JOIN resources r ON rp.resource_id = r.id
    JOIN applications a ON r.app_id = a.id
    WHERE rp.role_id = ?
    ORDER BY a.app_code, r.sort_order, rp.action
  `, [roleId])

  // Group by app and resource
  const grouped: Record<string, {
    appCode: string
    appName: string
    resources: Record<string, {
      resourceCode: string
      resourceName: string
      resourceId: number
      actions: string[]
    }>
  }> = {}

  for (const perm of permissions) {
    if (!grouped[perm.app_code]) {
      grouped[perm.app_code] = {
        appCode: perm.app_code,
        appName: perm.app_name,
        resources: {}
      }
    }
    const resKey = perm.resource_code
    if (!grouped[perm.app_code]!.resources[resKey]) {
      grouped[perm.app_code]!.resources[resKey] = {
        resourceCode: perm.resource_code,
        resourceName: perm.resource_name,
        resourceId: perm.resource_id,
        actions: []
      }
    }
    grouped[perm.app_code]!.resources[resKey]!.actions.push(perm.action)
  }

  // Convert to array format
  const result = Object.values(grouped).map(app => ({
    appCode: app.appCode,
    appName: app.appName,
    resources: Object.values(app.resources)
  }))

  // Also return flat permission strings for easy checking
  const permissionStrings = permissions.map(p => `${p.app_code}:${p.resource_code}:${p.action}`)

  return {
    success: true,
    data: {
      role: {
        id: role.id,
        roleCode: role.role_code,
        roleName: role.role_name,
        parentId: role.parent_id
      },
      permissions: result,
      permissionStrings
    }
  }
})
