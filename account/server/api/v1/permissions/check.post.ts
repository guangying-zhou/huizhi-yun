/**
 * 权限检查接口
 * POST /api/v1/permissions/check
 *
 * body: { uid, appCode, resourceCode, action }
 * 检查用户是否对指定资源有指定操作权限
 */
import { verifyApiKey } from '~~/server/utils/api-auth'
import { queryRows } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['权限管理'],
    summary: '检查用户权限',
    description: '检查指定用户是否拥有某资源的指定操作权限（RBAC）。需要 API Key 认证。',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['uid', 'appCode', 'resourceCode', 'action'],
            properties: {
              uid: { type: 'string', description: '用户名' },
              appCode: { type: 'string', description: '应用编码，如 account、codocs' },
              resourceCode: { type: 'string', description: '资源编码，如 admin、documents' },
              action: { type: 'string', enum: ['view', 'edit', 'admin'], description: '操作类型' }
            }
          }
        }
      }
    }
  }
})

interface CountRow extends RowDataPacket {
  count: number
}

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

  const body = await readBody(event)
  const { uid, appCode, resourceCode, action } = body

  if (!uid || !appCode || !resourceCode || !action) {
    throw createError({
      statusCode: 400,
      message: 'uid, appCode, resourceCode, and action are required'
    })
  }

  try {
    const rows = await queryRows<CountRow[]>(
      `SELECT COUNT(*) as count
       FROM role_permissions rp
       INNER JOIN resources res ON rp.resource_id = res.id
       INNER JOIN applications a ON res.app_id = a.id
       INNER JOIN user_roles ur ON rp.role_id = ur.role_id
       WHERE ur.uid = ?
         AND a.app_code = ?
         AND res.resource_code = ?
         AND rp.action = ?
         AND res.status = 1`,
      [uid, appCode, resourceCode, action]
    )

    const hasPermission = (rows[0]?.count || 0) > 0

    return {
      code: 0,
      data: {
        uid,
        permission: `${appCode}:${resourceCode}:${action}`,
        allowed: hasPermission
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to check permission:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to check permission'
    })
  }
})
