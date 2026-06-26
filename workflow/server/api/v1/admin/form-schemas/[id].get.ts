/**
 * GET /api/v1/admin/form-schemas/:id
 * 获取表单定义详情
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { queryRow } from '~~/server/utils/db'

interface FormSchemaRow extends RowDataPacket {
  id: number
  code: string
  name: string
  description: string | null
  fields: string
  version: number
  status: number
  created_by: string
  created_at: string
  updated_at: string
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: 'ID 必填' })
  }

  try {
    const row = await queryRow<FormSchemaRow>(
      'SELECT * FROM form_schemas WHERE id = ?',
      [id]
    )

    if (!row) {
      throw createError({ statusCode: 404, message: '表单定义不存在' })
    }

    return {
      code: 0,
      data: {
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        fields: typeof row.fields === 'string' ? JSON.parse(row.fields) : row.fields,
        version: row.version,
        status: row.status,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('查询表单定义详情失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '查询表单定义详情失败'
    })
  }
})
