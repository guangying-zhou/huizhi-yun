import { defineEventHandler, readBody, createError, getRouterParam } from 'h3'
import { queryRows, execute } from '../../utils/db'
import type { RowDataPacket } from 'mysql2/promise'
import { logOperationFromEvent } from '../../utils/log'

interface UpdateResourceBody {
  resourceName?: string
  description?: string
  sortOrder?: number
  status?: number
}

interface ResourceRow extends RowDataPacket {
  id: number
  resource_code: string
  resource_name: string
}

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的资源ID' })
  }

  const body = await readBody<UpdateResourceBody>(event)

  // Check if resource exists
  const existing = await queryRows<ResourceRow[]>('SELECT id, resource_code, resource_name FROM resources WHERE id = ?', [id])
  if (existing.length === 0) {
    throw createError({ statusCode: 404, message: '资源不存在' })
  }

  const currentResource = existing[0]
  if (!currentResource) {
    throw createError({ statusCode: 404, message: '资源不存在' })
  }

  // Build update query
  const updates: string[] = []
  const params: unknown[] = []

  if (body.resourceName !== undefined) {
    updates.push('resource_name = ?')
    params.push(body.resourceName)
  }
  if (body.description !== undefined) {
    updates.push('description = ?')
    params.push(body.description || null)
  }
  if (body.sortOrder !== undefined) {
    updates.push('sort_order = ?')
    params.push(body.sortOrder)
  }
  if (body.status !== undefined) {
    updates.push('status = ?')
    params.push(body.status)
  }

  if (updates.length === 0) {
    throw createError({ statusCode: 400, message: '没有需要更新的字段' })
  }

  params.push(id)
  await execute(`UPDATE resources SET ${updates.join(', ')} WHERE id = ?`, params)

  await logOperationFromEvent(event, {
    sourceApp: 'account',
    action: 'resource.update',
    targetType: 'resource',
    targetId: currentResource.resource_code,
    detail: {
      id,
      resourceName: currentResource.resource_name,
      changes: body
    }
  })

  return {
    success: true,
    message: '资源更新成功'
  }
})
