import { defineEventHandler, readBody, createError, getRouterParam } from 'h3'
import { queryRows, getConnection } from '../../../utils/db'
import type { RowDataPacket } from 'mysql2/promise'
import { logOperationFromEvent } from '../../../utils/log'

interface SetPermissionsBody {
  permissions: Array<{
    resourceId: number
    actions: ('view' | 'edit' | 'admin')[]
  }>
}

interface RoleRow extends RowDataPacket {
  id: number
  role_code: string
  parent_id: number | null
}

interface PermRow extends RowDataPacket {
  resource_id: number
  action: string
}

export default defineEventHandler(async (event) => {
  const roleId = Number(getRouterParam(event, 'id'))
  if (!roleId || isNaN(roleId)) {
    throw createError({ statusCode: 400, message: '无效的角色ID' })
  }

  const body = await readBody<SetPermissionsBody>(event)

  // Check if role exists and get parent
  const roles = await queryRows<RoleRow[]>(
    'SELECT id, role_code, parent_id FROM roles WHERE id = ?',
    [roleId]
  )
  if (roles.length === 0) {
    throw createError({ statusCode: 404, message: '角色不存在' })
  }
  const role = roles[0]!

  // If role has parent, validate permissions are within parent's scope
  if (role.parent_id) {
    const parentPermissions = await queryRows<PermRow[]>(
      'SELECT resource_id, action FROM role_permissions WHERE role_id = ?',
      [role.parent_id]
    )

    const parentSet = new Set(
      parentPermissions.map(p => `${p.resource_id}:${p.action}`)
    )

    for (const perm of body.permissions) {
      for (const action of perm.actions) {
        const key = `${perm.resourceId}:${action}`
        if (!parentSet.has(key)) {
          throw createError({
            statusCode: 400,
            message: `权限超出父角色范围: resource=${perm.resourceId}, action=${action}`
          })
        }
      }
    }
  }

  // Use transaction
  const connection = await getConnection()
  try {
    await connection.beginTransaction()

    // Delete existing permissions
    await connection.execute('DELETE FROM role_permissions WHERE role_id = ?', [roleId])

    // Insert new permissions
    for (const perm of body.permissions) {
      for (const action of perm.actions) {
        await connection.execute(
          'INSERT INTO role_permissions (role_id, resource_id, action) VALUES (?, ?, ?)',
          [roleId, perm.resourceId, action]
        )
      }
    }

    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  await logOperationFromEvent(event, {
    sourceApp: 'account',
    action: 'role.permissions.update',
    targetType: 'role',
    targetId: role.role_code,
    detail: {
      roleId,
      permissions: body.permissions
    }
  })

  return {
    success: true,
    message: '权限设置成功'
  }
})
