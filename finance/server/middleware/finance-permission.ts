import { getRequestURL, readBody } from 'h3'
import { requirePermission } from '../utils/checkPermission'
import {
  financeRouteNeedsBodyStatus,
  resolveFinanceApiPermission
} from '../utils/financePermissionRoutes'

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  const pathname = normalizeApiPath(url.pathname)
  if (!pathname.startsWith('/api/v1/finance/')) return

  const path = pathname.replace(/^\/api\/v1\/finance\/?/, '')
  if (path === 'workflow/callback' || path.startsWith('service/')) return

  const method = String(event.node.req.method || 'GET').toUpperCase()
  const bodyStatus = financeRouteNeedsBodyStatus(path, method)
    ? await readBody<Record<string, unknown>>(event).then(body => body?.status).catch(() => undefined)
    : undefined
  const rule = resolveFinanceApiPermission(path, method, { status: bodyStatus })
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
