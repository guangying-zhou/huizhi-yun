import { getQuery, getRequestURL, readBody, type H3Event } from 'h3'
import { requirePermission } from '~~/server/utils/checkPermission'
import { resolveAltocApiPermission } from '~~/server/utils/altocPermissionRoutes'

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  const pathname = normalizeApiPath(url.pathname)
  if (!pathname.startsWith('/api/v1/')) return

  const path = pathname.replace(/^\/api\/v1\/?/, '')
  if (!path || path.startsWith('service/')) return

  const method = String(event.node.req.method || 'GET').toUpperCase()
  const body = mutatingMethods.has(method) ? await readRequestBody(event) : {}
  const query = getQuery(event)
  const command = commandFrom(body)
  const entityType = String(
    body.entity_type
    || body.entityType
    || query.entity_type
    || query.entityType
    || ''
  )
  const rule = resolveAltocApiPermission(path, method, command, entityType)
  if (!rule) return

  await requirePermission(event, rule.resource, rule.action)
})

function normalizeApiPath(pathname: string) {
  const config = useRuntimeConfig() as unknown as { public?: { appBasePath?: string } }
  const basePath = String(config.public?.appBasePath || '').replace(/\/+$/, '')
  if (basePath && basePath !== '/' && pathname.startsWith(`${basePath}/api/`)) {
    return pathname.slice(basePath.length)
  }
  return pathname
}

async function readRequestBody(event: H3Event) {
  return await readBody<Record<string, unknown>>(event).catch(() => ({} as Record<string, unknown>))
}

function commandFrom(body: Record<string, unknown>) {
  return String(
    body.action
    || body.status
    || body.ticketStatus
    || body.ticket_status
    || body.deliveryStatus
    || body.delivery_status
    || body.workItemStatus
    || body.work_item_status
    || ''
  )
}
