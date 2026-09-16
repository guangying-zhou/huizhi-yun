import { useDbPool } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'
import type { H3Event } from 'h3'

interface ApiKeyRow extends RowDataPacket {
  id: number
  company_code: string | null
  key_name: string
  api_key: string
  api_secret: string
  status: number
  rate_limit: number
  expires_at: string | null
}

/**
 * Verify API Key from request headers or query params
 * Returns the API key record if valid, throws error if invalid
 */
export async function verifyApiKey(event: H3Event): Promise<ApiKeyRow> {
  const pool = useDbPool()

  // Get API key from Authorization header or query params
  let apiKey: string | undefined
  let apiSecret: string | undefined

  const authHeader = getHeader(event, 'authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    const parts = token.split(':')
    if (parts.length === 2) {
      apiKey = parts[0]
      apiSecret = parts[1]
    }
  }

  // Fallback to query params
  if (!apiKey) {
    const query = getQuery(event)
    apiKey = query.api_key as string
    apiSecret = query.api_secret as string
  }

  if (!apiKey || !apiSecret) {
    throw createError({
      statusCode: 401,
      message: 'Missing API credentials'
    })
  }

  // Verify API key
  const [rows] = await pool.query<ApiKeyRow[]>(
    'SELECT id, company_code, key_name, api_key, api_secret, status, rate_limit, expires_at FROM api_keys WHERE api_key = ?',
    [apiKey]
  )

  if (rows.length === 0) {
    throw createError({
      statusCode: 401,
      message: 'Invalid API key'
    })
  }

  const keyRecord = rows[0]
  if (!keyRecord) {
    throw createError({
      statusCode: 401,
      message: 'Invalid API key'
    })
  }

  // Verify secret
  if (keyRecord.api_secret !== apiSecret) {
    throw createError({
      statusCode: 401,
      message: 'Invalid API secret'
    })
  }

  // Check status
  if (keyRecord.status !== 1) {
    throw createError({
      statusCode: 403,
      message: 'API key is disabled'
    })
  }

  // Check expiration
  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
    throw createError({
      statusCode: 403,
      message: 'API key has expired'
    })
  }

  // Update last_used_at
  await pool.query(
    'UPDATE api_keys SET last_used_at = NOW() WHERE id = ?',
    [keyRecord.id]
  )

  return keyRecord
}
