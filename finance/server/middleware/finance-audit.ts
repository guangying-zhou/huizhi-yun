import { getRequestURL } from 'h3'
import { buildFinanceAuditFromRequest, writeFinanceAudit } from '../utils/financeAudit'

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export default defineEventHandler((event) => {
  const method = String(event.node.req.method || 'GET').toUpperCase()
  if (!mutatingMethods.has(method)) return

  const url = getRequestURL(event)
  const pathname = normalizeApiPath(url.pathname)
  if (!pathname.startsWith('/api/v1/finance/')) return

  event.node.res.once('finish', () => {
    const statusCode = event.node.res.statusCode || 200
    if (statusCode >= 500) return

    writeFinanceAudit(buildFinanceAuditFromRequest(event)).catch(() => undefined)
  })
})

function normalizeApiPath(pathname: string) {
  const config = useRuntimeConfig() as unknown as { public?: { appBasePath?: string } }
  const basePath = String(config.public?.appBasePath || '').replace(/\/+$/, '')
  if (basePath && basePath !== '/' && pathname.startsWith(`${basePath}/api/`)) {
    return pathname.slice(basePath.length)
  }
  return pathname
}
