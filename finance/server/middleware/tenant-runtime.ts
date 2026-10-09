import { handleProductCostRulesReadService } from '~~/server/utils/productCostRulesReadService'
import { createError, getRequestURL, type H3Event } from 'h3'
import { maybeCallCurrentFinanceDataRuntime } from '~~/server/utils/dataRuntime'
import { ensureFinanceConsoleAuth } from '~~/server/utils/authIdentity'
import { requireFinanceServiceCapability, type FinanceServiceAuthRequirement } from '~~/server/utils/serviceAuth'
import { handleProductCostService } from '~~/server/utils/productCostService'
import { handleProductCostRulesService } from '~~/server/utils/productCostRulesService'

const API_PREFIX = '/api/v1/finance'

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname
  if (financeApiPath(pathname) === '/api/v1/finance/service/product-cost/read-rules') return handleProductCostRulesReadService(event)
  if (financeApiPath(pathname) === '/api/v1/finance/service/product-cost/replace-rules') {
    return handleProductCostRulesService(event)
  }
  if (financeApiPath(pathname) === '/api/v1/finance/service/product-cost/read') {
    return handleProductCostService(event)
  }
  if (isAllowedLocalFinanceOrchestration(pathname, event.node.req.method)) {
    await requireForwardedServiceCapability(event)
    return
  }

  await requireForwardedServiceCapability(event)

  const runtimeResponse = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtimeResponse.handled) return runtimeResponse.data

  if (isFinanceApiPath(pathname)) {
    throw createError({
      statusCode: 503,
      message: 'Finance tenant-runtime is required for /api/v1/finance data access.'
    })
  }
})

function isAllowedLocalFinanceOrchestration(pathname: string, method = 'GET') {
  const normalizedMethod = method.toUpperCase()
  const apiPath = financeApiPath(pathname)
  if (normalizedMethod === 'GET' && apiPath === '/api/v1/finance/project-accounting/aims-projects') {
    return true
  }
  if (normalizedMethod === 'POST' && apiPath === '/api/v1/finance/invoices/files') {
    return true
  }
  if (normalizedMethod === 'GET' && apiPath === '/api/v1/finance/invoices/files/view') {
    return true
  }
  if (normalizedMethod === 'GET' && apiPath === '/api/v1/finance/reports/export') {
    return true
  }
  if (normalizedMethod === 'POST' && apiPath === '/api/v1/finance/authorization/instance-conflict-explain') {
    return true
  }
  if (normalizedMethod === 'POST' && apiPath === '/api/v1/service/notification-details/authorize') {
    return true
  }
  if (normalizedMethod === 'POST' && apiPath === '/api/v1/finance/service/invoice-requests/create') {
    return true
  }
  if ((normalizedMethod === 'GET' || normalizedMethod === 'POST') && /^\/api\/v1\/finance\/integration-operations(?:\/|$)/.test(apiPath)) {
    return true
  }
  if (normalizedMethod === 'POST' && /^\/api\/v1\/finance\/invoices\/[^/]+\/delete-with-file$/.test(apiPath)) {
    return true
  }
  if (normalizedMethod === 'POST' && /^\/api\/v1\/finance\/invoices\/[^/]+\/receipt-reconcile$/.test(apiPath)) {
    return true
  }
  return normalizedMethod === 'POST' && (
    apiPath === '/api/v1/finance/reconciliation'
    || apiPath === '/api/v1/finance/project-accounting/sync-people-costs'
  )
}

function isFinanceApiPath(pathname: string) {
  const index = pathname.indexOf(API_PREFIX)
  if (index < 0) return false

  const after = pathname[index + API_PREFIX.length] || ''
  return after === '' || after === '/'
}

function financeApiPath(pathname: string) {
  const index = pathname.indexOf(API_PREFIX)
  return index >= 0 ? pathname.slice(index) : pathname
}

function isFinanceServiceApiPath(pathname: string) {
  const apiPath = financeApiPath(pathname)
  return apiPath === `${API_PREFIX}/service` || apiPath.startsWith(`${API_PREFIX}/service/`)
}

function serviceCapabilityRequirement(pathname: string, method = 'GET'): FinanceServiceAuthRequirement | null {
  const apiPath = financeApiPath(pathname)
  const normalizedMethod = method.toUpperCase()
  if (normalizedMethod === 'POST' && apiPath === '/api/v1/finance/workflow/callback') {
    return { scope: 'workflow:callback', allowedApps: ['workflow'] }
  }
  if (normalizedMethod === 'POST' && apiPath === '/api/v1/finance/service/invoice-requests/create') {
    return { scope: 'finance:invoice-request:create', allowedApps: ['altoc'] }
  }
  if (normalizedMethod !== 'GET') return null
  if (/^\/api\/v1\/finance\/service\/customers\/[^/]+\/maintenance-financial-summary$/.test(apiPath)) {
    return { scope: 'finance:read', allowedApps: ['altoc', 'finance'] }
  }
  if (apiPath === '/api/v1/finance/service/people-cost-parameters') {
    return { scope: 'finance:read', allowedApps: ['people'] }
  }
  if (apiPath === '/api/v1/finance/service/performance-amounts') {
    return { scope: 'finance:read', allowedApps: ['people'] }
  }
  return null
}

async function requireForwardedServiceCapability(event: H3Event) {
  const url = getRequestURL(event)
  const requirement = serviceCapabilityRequirement(url.pathname, event.node.req.method || 'GET')
  if (!requirement) {
    if (isFinanceServiceApiPath(url.pathname)) {
      throw createError({
        statusCode: 403,
        message: 'Unsupported Finance service endpoint capability.'
      })
    }
    return
  }

  const auth = await ensureFinanceConsoleAuth(event)
  requireFinanceServiceCapability(auth, requirement)
}
