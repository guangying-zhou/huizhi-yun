import { getRequestURL } from 'h3'
import { reportOperationAudit } from '@hzy/foundation/server/utils/accountApi'
import { getRequestUid } from '~~/server/utils/authIdentity'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function normalizeSegment(value: string | undefined) {
  return String(value || 'api')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 32) || 'api'
}

function inferTarget(parts: string[]) {
  const resource = normalizeSegment(parts[2])
  const candidate = parts[3] || ''
  return {
    targetType: resource,
    targetId: candidate && !candidate.includes('/') ? candidate : null
  }
}

export default defineEventHandler((event) => {
  const method = String(event.node.req.method || 'GET').toUpperCase()
  if (!MUTATING_METHODS.has(method)) return

  const url = getRequestURL(event)
  if (!url.pathname.startsWith('/api/v1/')) return

  const uid = getRequestUid(event)
  const parts = url.pathname.split('/').filter(Boolean)
  const { targetType, targetId } = inferTarget(parts)
  const action = `aims.${targetType}.${method.toLowerCase()}`

  event.node.res.once('finish', () => {
    const statusCode = event.node.res.statusCode || 200
    reportOperationAudit({
      sourceApp: 'aims',
      operatorUid: uid || null,
      action,
      targetType,
      targetId,
      result: statusCode >= 400 ? 'failed' : 'success',
      detail: {
        method,
        path: url.pathname,
        statusCode,
        query: Object.fromEntries(url.searchParams.entries())
      }
    }).catch(() => undefined)
  })
})
