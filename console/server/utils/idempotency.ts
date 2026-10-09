import { getHeader, type H3Event } from 'h3'

export function requireIdempotencyKey(event: H3Event, message = '该操作必须提供 Idempotency-Key。') {
  const value = String(getHeader(event, 'idempotency-key') || '').trim()
  if (!value) {
    throw createError({ statusCode: 400, message })
  }
  return value
}
