import { defineEventHandler, createError, getRouterParam } from 'h3'
import { queryRows, execute } from '../../utils/db'
import type { RowDataPacket } from 'mysql2/promise'
import { logOperationFromEvent } from '../../utils/log'

interface ResourceRow extends RowDataPacket {
  id: number
  resource_code: string
}

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的资源ID' })
  }

  // Check if resource exists
  const existing = await queryRows<ResourceRow[]>('SELECT id, resource_code FROM resources WHERE id = ?', [id])
  if (existing.length === 0) {
    throw createError({ statusCode: 404, message: '资源不存在' })
  }

  const currentResource = existing[0]
  if (!currentResource) {
    throw createError({ statusCode: 404, message: '资源不存在' })
  }

  // Delete resource (role_permissions will cascade delete)
  await execute('DELETE FROM resources WHERE id = ?', [id])

  await logOperationFromEvent(event, {
    sourceApp: 'account',
    action: 'resource.delete',
    targetType: 'resource',
    targetId: currentResource.resource_code,
    detail: {
      id,
      resourceCode: currentResource.resource_code
    }
  })

  return {
    success: true,
    message: '资源删除成功'
  }
})
