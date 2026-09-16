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
  const body = await readBody(event)

  if (!id || isNaN(Number(id))) {
    throw createError({
      statusCode: 400,
      message: '无效的ID'
    })
  }

  const { keyName, scopes, rateLimit, ipWhitelist, expiresAt, status } = body

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

    const updates: string[] = []
    const params: unknown[] = []

    if (keyName !== undefined) {
      updates.push('key_name = ?')
      params.push(keyName)
    }

    if (scopes !== undefined) {
      updates.push('scopes = ?')
      params.push(scopes ? JSON.stringify(scopes) : null)
    }

    if (rateLimit !== undefined) {
      updates.push('rate_limit = ?')
      params.push(rateLimit)
    }

    if (ipWhitelist !== undefined) {
      updates.push('ip_whitelist = ?')
      params.push(ipWhitelist ? JSON.stringify(ipWhitelist) : null)
    }

    if (expiresAt !== undefined) {
      updates.push('expires_at = ?')
      params.push(expiresAt || null)
    }

    if (status !== undefined) {
      updates.push('status = ?')
      params.push(status)
    }

    if (updates.length === 0) {
      throw createError({
        statusCode: 400,
        message: '没有需要更新的字段'
      })
    }

    params.push(Number(id))

    const [result] = await pool.query<ResultSetHeader>(
      `UPDATE api_keys SET ${updates.join(', ')} WHERE id = ?`,
      params
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
        action: 'api_key.update',
        targetType: 'api_key',
        targetId: existingRows[0].api_key,
        detail: {
          id: Number(id),
          keyName: existingRows[0].key_name,
          changes: body
        }
      })
    }

    return {
      code: 0,
      message: '更新成功'
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to update API key:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '更新API密钥失败'
    })
  }
})
