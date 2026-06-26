/**
 * POST /api/v1/admin/form-schemas
 * 创建表单定义
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'
import { queryRow, execute } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const currentUser = getRequestUid(event)
  if (!currentUser) {
    throw createError({ statusCode: 401, message: '未登录' })
  }

  const body = await readBody(event)
  const { code, name, description, fields } = body

  if (!code || !name || !fields) {
    throw createError({
      statusCode: 400,
      message: 'code, name, fields 必填'
    })
  }

  try {
    const existing = await queryRow<RowDataPacket>(
      'SELECT id FROM form_schemas WHERE code = ?',
      [code]
    )
    if (existing) {
      throw createError({ statusCode: 400, message: '表单编码已存在' })
    }

    const result = await execute<ResultSetHeader>(
      `INSERT INTO form_schemas (code, name, description, fields, version, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1, ?, NOW(), NOW())`,
      [code, name, description || null, JSON.stringify(fields), currentUser]
    )

    return {
      code: 0,
      data: { id: result.insertId, code, name }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('创建表单定义失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '创建表单定义失败'
    })
  }
})
