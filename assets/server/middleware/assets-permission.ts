import { getRequestURL, readBody, type H3Event } from 'h3'
import { requirePermission } from '~~/server/utils/checkPermission'
import { resolveAssetsApiPermission } from '~~/server/utils/assetsPermissionRoutes'

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  const pathname = normalizeApiPath(url.pathname)
  if (!pathname.startsWith('/api/v1/')) return

  const path = pathname.replace(/^\/api\/v1\/?/, '')
  if (!path || path.startsWith('service/')) return

  const method = String(event.node.req.method || 'GET').toUpperCase()
  const status = mutatingMethods.has(method) ? await bodyStatus(event) : ''
  const rule = resolveAssetsApiPermission(path, method, status)
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

async function bodyStatus(event: H3Event) {
  const body = await readBody<Record<string, unknown>>(event).catch(() => ({} as Record<string, unknown>))
  return String(body?.status || body?.workflowStatus || body?.workflow_status || '').trim().toLowerCase()
}
