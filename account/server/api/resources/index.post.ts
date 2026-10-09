import { defineEventHandler, readBody, createError } from 'h3'
import { queryRows, execute } from '../../utils/db'
import type { RowDataPacket } from 'mysql2/promise'
import { logOperationFromEvent } from '../../utils/log'

interface CreateResourceBody {
  appId: number
  resourceCode: string
  resourceName: string
  description?: string
  sortOrder?: number
  status?: number
}

interface IdRow extends RowDataPacket {
  id: number
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CreateResourceBody>(event)

  // Validation
  if (!body.appId) {
    throw createError({ statusCode: 400, message: '应用ID不能为空' })
  }
  if (!body.resourceCode) {
    throw createError({ statusCode: 400, message: '资源编码不能为空' })
  }
  if (!body.resourceName) {
    throw createError({ statusCode: 400, message: '资源名称不能为空' })
  }

  // Validate resource_code format (lowercase, alphanumeric, underscore)
  if (!/^[a-z][a-z0-9_]*$/.test(body.resourceCode)) {
    throw createError({
      statusCode: 400,
      message: '资源编码格式错误：必须以小写字母开头，只能包含小写字母、数字和下划线'
    })
  }

  // Check if app exists
  const apps = await queryRows<IdRow[]>('SELECT id FROM applications WHERE id = ?', [body.appId])
  if (apps.length === 0) {
    throw createError({ statusCode: 404, message: '应用不存在' })
  }

  // Check if resource_code already exists for this app
  const existing = await queryRows<IdRow[]>(
    'SELECT id FROM resources WHERE app_id = ? AND resource_code = ?',
    [body.appId, body.resourceCode]
  )
  if (existing.length > 0) {
    throw createError({ statusCode: 409, message: '该应用下已存在相同编码的资源' })
  }

  // Insert
  const result = await execute(
    `INSERT INTO resources (app_id, resource_code, resource_name, description, sort_order, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      body.appId,
      body.resourceCode,
      body.resourceName,
      body.description || null,
      body.sortOrder ?? 0,
      body.status ?? 1
    ]
  )

  await logOperationFromEvent(event, {
    sourceApp: 'account',
    action: 'resource.create',
    targetType: 'resource',
    targetId: body.resourceCode,
    detail: {
      id: result.insertId,
      appId: body.appId,
      resourceCode: body.resourceCode,
      resourceName: body.resourceName
    }
  })

  return {
    success: true,
    message: '资源创建成功',
    data: {
      id: result.insertId
    }
  }
})
