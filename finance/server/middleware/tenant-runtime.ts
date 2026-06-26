import { createError, getRequestURL, type H3Event } from 'h3'
import { maybeCallCurrentFinanceDataRuntime } from '~~/server/utils/dataRuntime'
import { ensureFinanceConsoleAuth } from '~~/server/utils/authIdentity'

const API_PREFIX = '/api/v1/finance'

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname
  if (isAllowedLocalFinanceOrchestration(pathname, event.node.req.method)) return

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
  const index = pathname.indexOf(API_PREFIX)
  const apiPath = index >= 0 ? pathname.slice(index) : pathname
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
  if (normalizedMethod === 'POST' && /^\/api\/v1\/finance\/invoices\/[^/]+\/delete-with-file$/.test(apiPath)) {
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

interface ConsoleAuthContext {
  authenticated?: boolean
  tokenUse?: string
  subjectType?: string
  appCode?: string
  clientCode?: string
  scopes?: string[]
}

interface ServiceCapabilityRequirement {
  scope: string
  allowedApps: string[]
}

function serviceCapabilityRequirement(pathname: string, method = 'GET'): ServiceCapabilityRequirement | null {
  const index = pathname.indexOf(API_PREFIX)
  const apiPath = index >= 0 ? pathname.slice(index) : pathname
  const normalizedMethod = method.toUpperCase()
  if (normalizedMethod === 'POST' && apiPath === '/api/v1/finance/workflow/callback') {
    return { scope: 'workflow:callback', allowedApps: ['workflow'] }
  }
  if (normalizedMethod !== 'GET') return null
  if (/^\/api\/v1\/finance\/service\/customers\/[^/]+\/maintenance-financial-summary$/.test(apiPath)) {
    return { scope: 'finance:read', allowedApps: ['altoc', 'finance'] }
  }
  if (apiPath === '/api/v1/finance/service/people-cost-parameters') {
    return { scope: 'finance:read', allowedApps: ['people', 'finance'] }
  }
  if (apiPath === '/api/v1/finance/service/performance-amounts') {
    return { scope: 'finance:read', allowedApps: ['people', 'finance'] }
  }
  return null
}

function sourceApp(auth: ConsoleAuthContext) {
  return String(auth.appCode || auth.clientCode || '').trim().replace(/\.runtime$/, '')
}

function hasServiceCapability(scopes: string[], required: string) {
  const scopeSet = new Set(scopes)
  if (scopeSet.has(required)) return true
  return scopeSet.has('finance:*') || scopeSet.has('finance:admin')
}

async function requireForwardedServiceCapability(event: H3Event) {
  const url = getRequestURL(event)
  const requirement = serviceCapabilityRequirement(url.pathname, event.node.req.method || 'GET')
  if (!requirement) return

  const auth = await ensureFinanceConsoleAuth(event) as ConsoleAuthContext | undefined
  if (!auth?.authenticated || auth.tokenUse !== 'service' || auth.subjectType !== 'service') {
    throw createError({ statusCode: 401, message: 'Console service token is required.' })
  }
  if (!hasServiceCapability(auth.scopes || [], requirement.scope)) {
    throw createError({ statusCode: 403, message: `Missing required service scope: ${requirement.scope}` })
  }
  if (!requirement.allowedApps.includes(sourceApp(auth))) {
    throw createError({ statusCode: 403, message: 'Service caller is not allowed for this endpoint.' })
  }
}
