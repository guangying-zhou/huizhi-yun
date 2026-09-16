import { useDbPool } from '~~/server/utils/db'
import { randomBytes } from 'crypto'
import { logOperationFromEvent } from '~~/server/utils/log'
import type { ResultSetHeader } from 'mysql2/promise'

export default defineEventHandler(async (event) => {
  const pool = useDbPool()
  const body = await readBody(event)

  const { keyName, scopes, rateLimit, ipWhitelist, expiresAt } = body

  if (!keyName) {
    throw createError({
      statusCode: 400,
      message: '密钥名称不能为空'
    })
  }

  try {
    // Generate API key and secret
    const apiKey = 'ak_' + randomBytes(16).toString('hex')
    const apiSecret = 'sk_' + randomBytes(32).toString('hex')

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO api_keys (key_name, api_key, api_secret, scopes, rate_limit, ip_whitelist, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        keyName,
        apiKey,
        apiSecret,
        scopes ? JSON.stringify(scopes) : null,
        rateLimit || 1000,
        ipWhitelist ? JSON.stringify(ipWhitelist) : null,
        expiresAt || null
      ]
    )

    await logOperationFromEvent(event, {
      sourceApp: 'account',
      action: 'api_key.create',
      targetType: 'api_key',
      targetId: apiKey,
      detail: {
        id: result.insertId,
        keyName,
        rateLimit: rateLimit || 1000,
        expiresAt: expiresAt || null
      }
    })

    return {
      code: 0,
      message: '创建成功',
      data: {
        id: result.insertId,
        keyName,
        apiKey,
        apiSecret // Only return secret once at creation
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to create API key:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '创建API密钥失败'
    })
  }
})
