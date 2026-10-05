import { useDbPool } from '~~/server/utils/db'
import { logOperationFromEvent } from '~~/server/utils/log'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'

interface ApiKeyRow extends RowDataPacket {
  id: number
  api_key: string
  key_name: string
}

export default defineEventHandler(async (event) => {
  const pool = useDbPool()
  const id = getRouterParam(event, 'id')

  if (!id || isNaN(Number(id))) {
    throw createError({
      statusCode: 400,
      message: '无效的ID'
    })
  }

  try {
    const [existingRows] = await pool.query<ApiKeyRow[]>(
      'SELECT id, api_key, key_name FROM api_keys WHERE id = ?',
      [Number(id)]
    )

    if (existingRows.length === 0) {
      throw createError({
        statusCode: 404,
        message: 'API密钥不存在'
      })
    }

    const [result] = await pool.query<ResultSetHeader>(
      'DELETE FROM api_keys WHERE id = ?',
      [Number(id)]
    )

    if (result.affectedRows === 0) {
      throw createError({
        statusCode: 404,
        message: 'API密钥不存在'
      })
    }

    if (existingRows[0]) {
      await logOperationFromEvent(event, {
        sourceApp: 'account',
        action: 'api_key.delete',
        targetType: 'api_key',
        targetId: existingRows[0].api_key,
        detail: {
          id: Number(id),
          keyName: existingRows[0].key_name
        }
      })
    }

    return {
      code: 0,
      message: '删除成功'
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to delete API key:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '删除API密钥失败'
    })
  }
})
