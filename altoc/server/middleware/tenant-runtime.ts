import { createError, getQuery, getRequestURL, type H3Event } from 'h3'
import { maybeProxyCurrentApiToTenantRuntime, type TenantRuntimeProxyContext } from '@hzy/foundation/server/utils/tenantRuntimeProxy'
import { ensureAltocConsoleAuth } from '~~/server/utils/authIdentity'
import { resolveAltocApiPermission } from '~~/server/utils/altocPermissionRoutes'
import { resolveAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'

const APP_CODE = 'altoc'
const API_PREFIX = '/api/v1'
const RUNTIME_RESOURCES = [
  '/audit-logs',
  '/contracts',
  '/customers',
  '/leads',
  '/maintenance-contracts',
  '/opportunities',
  '/payments',
  '/quotes',
  '/renewal-opportunities',
  '/service-entitlements',
  '/service-tickets',
  '/tenders',
  '/teams'
]
const RUNTIME_NESTED_RESOURCES = [
  /^\/customers\/[^/]+\/contacts$/,
  /^\/opportunities\/[^/]+\/contact-roles$/,
  /^\/opportunities\/[^/]+\/activities$/,
  /^\/tenders\/[^/]+\/milestones$/,
  /^\/tenders\/[^/]+\/members$/,
  /^\/quotes\/[^/]+\/items$/,
  /^\/contracts\/[^/]+\/lines$/,
  /^\/contracts\/[^/]+\/obligations$/,
  /^\/contracts\/[^/]+\/billing-schedules$/,
  /^\/contracts\/[^/]+\/project-links$/,
  /^\/contracts\/[^/]+\/delivery-asset-plans$/,
  /^\/contracts\/[^/]+\/service-agreements$/,
  /^\/contracts\/[^/]+\/stages$/
]
const RUNTIME_NESTED_RECORDS = [
  /^\/customers\/[^/]+\/contacts\/[^/]+$/,
  /^\/customers\/[^/]+\/invoice-infos\/[^/]+$/,
  /^\/opportunities\/[^/]+\/activities\/[^/]+$/,
  /^\/opportunities\/[^/]+\/contact-roles\/[^/]+$/,
  /^\/quotes\/[^/]+\/items\/[^/]+$/,
  /^\/contracts\/[^/]+\/lines\/[^/]+$/,
  /^\/contracts\/[^/]+\/obligations\/[^/]+$/,
  /^\/contracts\/[^/]+\/billing-schedules\/[^/]+$/,
  /^\/contracts\/[^/]+\/project-links\/[^/]+$/,
  /^\/contracts\/[^/]+\/delivery-asset-plans\/[^/]+$/,
  /^\/contracts\/[^/]+\/service-agreements\/[^/]+$/,
  /^\/contracts\/[^/]+\/stages\/[^/]+$/
]
const RUNTIME_CONFIG_RESOURCES = [
  '/config/customer-levels',
  '/config/customer-types',
  '/config/opportunity-stages',
  '/config/payment-term-templates',
  '/config/contract-business-templates'
]
const STATIC_RUNTIME_RESOURCE_SCOPES = [
  { prefix: '/config/dict', resource: 'settings' },
  { prefix: '/dashboard', resource: 'dashboard' },
  { prefix: '/tenders', resource: 'quotation' }
]
export default defineEventHandler(async (event) => {
  await requireForwardedServiceCapability(event)

  const runtimeResponse = await maybeProxyCurrentApiToTenantRuntime(event, {
    appCode: APP_CODE,
    shouldForward: shouldForwardAltocRuntime,
    resolveScope: scopeFor,
    resolveQuery: resolveAltocRuntimeQuery
  })

  if (runtimeResponse !== undefined) return runtimeResponse

  const pathname = getRequestURL(event).pathname
  if (isAllowedNuxtApiV1Path(pathname, event.node.req.method || 'GET', event)) return

  if (isApiV1Path(pathname)) {
    throw createError({
      statusCode: 503,
      message: 'Altoc tenant-runtime is required for /api/v1 data access.'
    })
  }
})

function shouldForwardAltocRuntime(context: TenantRuntimeProxyContext) {
  if (context.method === 'GET' && context.suffix.startsWith('/dashboard')) return true
  if (/^\/service\/customers\/[^/]+\/maintenance-summary$/.test(context.suffix)) return context.method === 'GET'
  if (/^\/customers\/[^/]+\/invoice-info:save$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/service\/contracts\/[^/]+\/finance-summary:sync$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/service\/contracts\/[^/]+\/invoice-request:prepare$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/service\/contracts\/[^/]+\/invoice-request:record$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/service\/receivable-plans\/[^/]+\/invoice-request:prepare$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/service\/receivable-plans\/[^/]+\/invoice-request:record$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/service\/receivable-plans\/[^/]+\/mark-billable$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/service\/payment-terms\/[^/]+\/receivable-plan:mark-billable$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/service\/customer-delivery-assets\/[^/]+\/status:sync$/.test(context.suffix)) return false
  if (/^\/service\/service-tickets\/[^/]+\/delivery-result:sync$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/service\/service-agreements\/[^/]+\/coverages$/.test(context.suffix)) return context.method === 'GET'
  if (/^\/service\/service-agreements\/[^/]+\/coverages\/[^/]+:(resolve|suspend|end|confirm-legacy)$/.test(context.suffix)) return false
  if (/^\/service\/service-agreement-coverages\/by-(environment|delivery-asset)\/[^/]+$/.test(context.suffix)) return context.method === 'GET'
  if (/^\/service\/service-agreements\/[^/]+\/project-relations$/.test(context.suffix)) return context.method === 'GET' || context.method === 'POST'
  if (/^\/service\/service-agreements\/[^/]+\/project-relations\/default$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/service\/service-agreements\/[^/]+\/project-relations\/[^/]+:(end|suspend)$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/service\/service-agreements\/[^/]+\/default-project$/.test(context.suffix)) return context.method === 'GET'
  if (/^\/service\/service-agreement-projects\/by-project\/[^/]+$/.test(context.suffix)) return context.method === 'GET'
  if (/^\/service\/projects\/[^/]+\/contract-lines$/.test(context.suffix)) return context.method === 'GET'
  if (/^\/leads\/[^/]+\/disqualify$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/leads\/[^/]+\/convert$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/leads\/[^/]+\/conversion-preview$/.test(context.suffix)) return context.method === 'GET'
  if (/^\/leads\/[^/]+\/conversion-candidates$/.test(context.suffix)) return context.method === 'GET'
  if (/^\/leads\/[^/]+\/activities$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/opportunities\/[^/]+\/transition$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/opportunities\/[^/]+\/close-won$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/opportunities\/[^/]+\/close-lost$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/opportunities\/[^/]+\/pause$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/opportunities\/[^/]+\/reopen$/.test(context.suffix)) return context.method === 'POST'
  if (context.suffix === '/config/dict') return context.method === 'POST' || context.method === 'PUT' || context.method === 'PATCH' || context.method === 'DELETE'
  if (context.suffix === '/tenders/agencies') return context.method === 'GET' || context.method === 'POST'
  if (/^\/tenders\/[^/]+\/milestones$/.test(context.suffix)) return context.method === 'POST' || context.method === 'PUT' || context.method === 'PATCH'
  if (/^\/tenders\/[^/]+\/members$/.test(context.suffix)) return context.method === 'POST' || context.method === 'DELETE'
  if (context.suffix === '/teams/users') return context.method === 'GET' && hasTeamIDQuery(context.event)
  if (/^\/teams\/[^/]+\/members$/.test(context.suffix)) return context.method === 'POST' || context.method === 'DELETE'
  if (/^\/quotes\/[^/]+\/approve$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/quotes\/[^/]+\/status$/.test(context.suffix)) return context.method === 'POST'
  if (context.suffix === '/contracts/drafts') return context.method === 'POST'
  if (context.suffix === '/contracts/from-quotation') return context.method === 'POST'
  if (/^\/contracts\/[^/]+\/draft$/.test(context.suffix)) return context.method === 'PATCH' || context.method === 'PUT'
  if (/^\/contracts\/[^/]+\/validate$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/contracts\/[^/]+\/activation-plan$/.test(context.suffix)) return context.method === 'GET'
  if (/^\/contracts\/[^/]+\/activation-plan\/preview$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/contracts\/[^/]+\/activation\/execute$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/contracts\/[^/]+\/activation\/jobs\/[^/]+$/.test(context.suffix)) return context.method === 'GET'
  if (/^\/contracts\/[^/]+\/activation\/jobs\/[^/]+\/(retry|cancel)$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/contracts\/[^/]+\/activation\/jobs\/[^/]+\/steps\/[^/]+\/result$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/contracts\/[^/]+\/(submit|withdraw|mark-signed|suspend|terminate)$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/contracts\/[^/]+\/fulfillment\/close$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/contract-obligations\/[^/]+\/(start|submit|accept|reject)$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/contracts\/[^/]+\/approve$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/contracts\/[^/]+\/status$/.test(context.suffix)) return context.method === 'POST'
  if (/^\/payments\/[^/]+\/confirm$/.test(context.suffix)) return context.method === 'POST'
  if (RUNTIME_CONFIG_RESOURCES.includes(context.suffix)) return context.method === 'GET'
  if (/^\/customers\/[^/]+\/invoice-infos$/.test(context.suffix)) return context.method === 'GET' || context.method === 'POST'
  if (/^\/customers\/[^/]+\/invoice-infos\/[^/]+$/.test(context.suffix)) return context.method === 'GET' || context.method === 'PUT' || context.method === 'PATCH' || context.method === 'DELETE'
  if (/^\/contracts\/[^/]+\/invoices$/.test(context.suffix)) return context.method === 'GET'
  if (/^\/contracts\/[^/]+\/(obligations|billing-schedules|delivery-asset-plans|service-agreements)(\/[^/]+)?$/.test(context.suffix)) return context.method === 'GET'
  if (context.suffix === '/documents') return context.method === 'GET'
  if (/^\/documents\/[^/]+$/.test(context.suffix)) return context.method === 'GET' || context.method === 'DELETE'
  if (RUNTIME_NESTED_RESOURCES.some(pattern => pattern.test(context.suffix))) return context.method === 'GET' || context.method === 'POST'
  if (RUNTIME_NESTED_RECORDS.some(pattern => pattern.test(context.suffix))) return context.method === 'GET' || context.method === 'PUT' || context.method === 'PATCH' || context.method === 'DELETE'
  if ((context.suffix === '/leads' || context.suffix === '/opportunities') && context.method === 'POST') return false
  return isCrudPath(context.suffix, context.method, RUNTIME_RESOURCES)
}

function isAllowedNuxtApiV1Path(pathname: string, method: string, event: H3Event) {
  const index = pathname.indexOf(API_PREFIX)
  const apiPath = index >= 0 ? pathname.slice(index) : pathname
  const normalizedMethod = method.toUpperCase()
  return (normalizedMethod === 'POST' && /^\/api\/v1\/service\/contracts\/[^/]+\/activate-delivery$/.test(apiPath))
    || (normalizedMethod === 'GET' && apiPath === '/api/v1/teams/users' && !hasTeamIDQuery(event))
    || (normalizedMethod === 'GET' && /^\/api\/v1\/customers\/[^/]+\/maintenance-summary$/.test(apiPath))
    || (normalizedMethod === 'GET' && /^\/api\/v1\/customers\/[^/]+\/delivery-package$/.test(apiPath))
    || (normalizedMethod === 'GET' && apiPath === '/api/v1/assets/products')
    || (normalizedMethod === 'GET' && /^\/api\/v1\/customers\/[^/]+\/maintenance-financial-summary$/.test(apiPath))
    || (normalizedMethod === 'POST' && /^\/api\/v1\/service-tickets\/[^/]+\/aims-work-item$/.test(apiPath))
    || (normalizedMethod === 'POST' && /^\/api\/v1\/service\/customer-delivery-assets\/[^/]+\/status:sync$/.test(apiPath))
    || (normalizedMethod === 'POST' && /^\/api\/v1\/service\/service-agreements\/[^/]+\/coverages$/.test(apiPath))
    || (normalizedMethod === 'POST' && /^\/api\/v1\/service\/service-agreements\/[^/]+\/coverages\/[^/]+:(resolve|suspend|end|confirm-legacy)$/.test(apiPath))
    || (normalizedMethod === 'POST' && /^\/api\/v1\/receivable-plans\/[^/]+\/invoice-request$/.test(apiPath))
    || (normalizedMethod === 'POST' && /^\/api\/v1\/contracts\/[^/]+\/invoice-request$/.test(apiPath))
    || (normalizedMethod === 'GET' && /^\/api\/v1\/contracts\/[^/]+\/eligible-aims-projects$/.test(apiPath))
    || (normalizedMethod === 'GET' && /^\/api\/v1\/contracts\/invoice-files\/view$/.test(apiPath))
    || (normalizedMethod === 'POST' && /^\/api\/v1\/contracts\/[^/]+\/management$/.test(apiPath))
    || (normalizedMethod === 'POST' && apiPath === '/api/v1/documents')
    || (normalizedMethod === 'POST' && apiPath === '/api/v1/leads')
    || (normalizedMethod === 'POST' && apiPath === '/api/v1/opportunities')
    || (normalizedMethod === 'POST' && /^\/api\/v1\/leads\/[^/]+\/assign$/.test(apiPath))
    || (normalizedMethod === 'POST' && /^\/api\/v1\/opportunities\/[^/]+\/assign$/.test(apiPath))
    || (normalizedMethod === 'POST' && apiPath === '/api/v1/opportunities/scan-stale')
    || (normalizedMethod === 'POST' && apiPath === '/api/v1/payments/scan-overdue')
    || (normalizedMethod === 'GET' && apiPath === '/api/v1/config/industries')
    || (normalizedMethod === 'GET' && apiPath === '/api/v1/config/regions')
    || (normalizedMethod === 'GET' && apiPath === '/api/v1/documents/preview')
}

function hasTeamIDQuery(event: H3Event) {
  const query = getQuery(event)
  const value = query.team_id || query.teamId
  if (Array.isArray(value)) return value.some(item => String(item || '').trim() !== '')
  return String(value || '').trim() !== ''
}

function scopeFor(context: TenantRuntimeProxyContext) {
  const transportScope = context.method === 'GET' ? 'altoc.read' : 'altoc.write'
  const query = getQuery(context.event)
  const entityType = String(query.entity_type || query.entityType || '')
  const rule = resolveAltocApiPermission(context.suffix, context.method, '', entityType)
  const resource = runtimeResourceFor(context, entityType) || rule?.resource
  const action = runtimeActionFor(context) || rule?.action
  if (!resource || !action) return transportScope
  const resourceScopes = [
    `altoc:${resource}:${action}`,
    ...additionalRuntimeResourceScopes(context)
  ]
  return `${transportScope} ${Array.from(new Set(resourceScopes)).join(' ')}`
}

function runtimeResourceFor(context: TenantRuntimeProxyContext, entityType: string) {
  const documentResource = documentRuntimeResource(context, entityType)
  if (documentResource) return documentResource
  const staticResource = STATIC_RUNTIME_RESOURCE_SCOPES.find(item => context.suffix.startsWith(item.prefix))
  return staticResource?.resource || ''
}

function documentRuntimeResource(context: TenantRuntimeProxyContext, entityType: string) {
  if (!/^\/documents(\/[^/]+)?$/.test(context.suffix)) return ''
  if (entityType === 'customer') return 'customer'
  if (entityType === 'lead') return 'lead'
  if (entityType === 'opportunity') return 'opportunity'
  if (entityType === 'quotation' || entityType === 'tender') return 'quotation'
  if (entityType === 'contract') return 'contract'
  return ''
}

function runtimeActionFor(context: TenantRuntimeProxyContext) {
  if (/^\/opportunities\/[^/]+\/close-won$/.test(context.suffix)) return 'transition'
  if (/^\/opportunities\/[^/]+\/close-lost$/.test(context.suffix)) return 'transition'
  if (/^\/opportunities\/[^/]+\/pause$/.test(context.suffix)) return 'transition'
  if (/^\/opportunities\/[^/]+\/reopen$/.test(context.suffix)) return 'transition'
  return ''
}

function additionalRuntimeResourceScopes(context: TenantRuntimeProxyContext) {
  const scopes: string[] = []
  if (context.method === 'POST' && /^\/contracts\/[^/]+\/status$/.test(context.suffix)) {
    scopes.push('altoc:contract:approve')
  }
  if (context.method === 'POST' && /^\/contracts\/[^/]+\/(submit|withdraw|mark-signed|suspend|terminate)$/.test(context.suffix)) {
    scopes.push('altoc:contract:edit')
  }
  if (context.method === 'POST' && /^\/contracts\/[^/]+\/fulfillment\/close$/.test(context.suffix)) {
    scopes.push('altoc:contract:edit')
  }
  if (context.method === 'POST' && /^\/contracts\/[^/]+\/activation/.test(context.suffix)) {
    scopes.push('altoc:contract:edit')
  }
  if (context.method === 'POST' && /^\/contract-obligations\/[^/]+\/(start|submit|accept|reject)$/.test(context.suffix)) {
    scopes.push('altoc:contract:edit')
  }
  if ((context.method === 'PATCH' || context.method === 'PUT') && /^\/service-tickets\/[^/]+$/.test(context.suffix)) {
    scopes.push('altoc:service_ticket:close')
  }
  return scopes
}

const ALTOC_DATA_ACCESS_QUERY_KEYS = [
  'current_user_altoc_access',
  'currentUserAltocAccess',
  'current_user_altoc_dept_code',
  'currentUserAltocDeptCode',
  'current_user_altoc_dept_codes',
  'currentUserAltocDeptCodes',
  'current_user_data_access',
  'currentUserDataAccess',
  'current_user_data_dept_code',
  'currentUserDataDeptCode',
  'current_user_data_dept_codes',
  'currentUserDataDeptCodes'
]

const ALTOC_SCOPED_DATA_RESOURCES = new Set([
  'customer',
  'lead',
  'opportunity',
  'quotation',
  'contract',
  'receivable',
  'maintenance_contract',
  'service_entitlement',
  'service_ticket',
  'renewal_opportunity',
  'dashboard'
])

async function resolveAltocRuntimeQuery(context: TenantRuntimeProxyContext, query: Record<string, unknown>) {
  const sanitizedQuery = Object.fromEntries(
    Object.entries(query).filter(([key]) => !ALTOC_DATA_ACCESS_QUERY_KEYS.includes(key))
  )

  if (!context.currentUser || context.suffix.startsWith('/service/')) return sanitizedQuery

  const rawQuery = getQuery(context.event)
  const entityType = String(rawQuery.entity_type || rawQuery.entityType || '')
  const rule = resolveAltocApiPermission(context.suffix, context.method, '', entityType)
  if (!rule || !ALTOC_SCOPED_DATA_RESOURCES.has(rule.resource)) {
    return sanitizedQuery
  }

  Object.assign(
    sanitizedQuery,
    await resolveAltocDataAccessQuery(
      context.event,
      context.currentUser,
      context.currentDeptCodes,
      rule.resource,
      rule.action
    )
  )
  return sanitizedQuery
}

function isCrudPath(suffix: string, method: TenantRuntimeProxyContext['method'], resources: string[]) {
  for (const resource of resources) {
    if (suffix === resource) return method === 'GET' || method === 'POST'
    if (suffix.startsWith(`${resource}/`)) {
      const rest = suffix.slice(resource.length + 1).split('/').filter(Boolean)
      return rest.length === 1 && (method === 'GET' || method === 'PATCH' || method === 'PUT' || method === 'DELETE')
    }
  }
  return false
}

function isApiV1Path(pathname: string) {
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

function serviceCapabilityRequirement(suffix: string, method: string): ServiceCapabilityRequirement | null {
  if (method === 'GET' && /^\/service\/customers\/[^/]+\/maintenance-summary$/.test(suffix)) {
    return { scope: 'altoc:read', allowedApps: ['finance'] }
  }
  if (method === 'GET' && /^\/service\/service-agreements\/[^/]+\/coverages$/.test(suffix)) {
    return { scope: 'altoc:read', allowedApps: ['assets', 'aims', 'finance', 'altoc'] }
  }
  if (method === 'GET' && /^\/service\/service-agreement-coverages\/by-(environment|delivery-asset)\/[^/]+$/.test(suffix)) {
    return { scope: 'altoc:read', allowedApps: ['assets', 'aims', 'finance', 'altoc'] }
  }
  if (method !== 'POST') return null

  if (/^\/service\/service-agreements\/[^/]+\/coverages$/.test(suffix)) {
    return { scope: 'altoc:contract:edit', allowedApps: ['assets', 'aims', 'altoc'] }
  }
  if (/^\/service\/service-agreements\/[^/]+\/coverages\/[^/]+:(resolve|suspend|end|confirm-legacy)$/.test(suffix)) {
    return { scope: 'altoc:contract:edit', allowedApps: ['assets', 'aims', 'altoc'] }
  }
  if (/^\/service\/receivable-plans\/[^/]+\/mark-billable$/.test(suffix)) {
    return { scope: 'altoc:receivable:mark-billable', allowedApps: ['aims'] }
  }
  if (/^\/service\/payment-terms\/[^/]+\/receivable-plan:mark-billable$/.test(suffix)) {
    return { scope: 'altoc:receivable:mark-billable', allowedApps: ['aims'] }
  }
  if (/^\/service\/contracts\/[^/]+\/finance-summary:sync$/.test(suffix)) {
    return { scope: 'altoc:contract:finance-summary:sync', allowedApps: ['finance'] }
  }
  if (/^\/service\/customer-delivery-assets\/[^/]+\/status:sync$/.test(suffix)) {
    return { scope: 'altoc:contract:delivery-asset-status:sync', allowedApps: ['assets'] }
  }
  if (/^\/service\/service-tickets\/[^/]+\/delivery-result:sync$/.test(suffix)) {
    return { scope: 'altoc:service_ticket:delivery-result:sync', allowedApps: ['aims'] }
  }
  return null
}

function sourceApp(auth: ConsoleAuthContext) {
  return String(auth.appCode || auth.clientCode || '').trim().replace(/\.runtime$/, '')
}

function hasServiceCapability(scopes: string[], required: string) {
  const scopeSet = new Set(scopes)
  if (scopeSet.has(required)) return true
  return scopeSet.has('altoc:*') || scopeSet.has('altoc:admin') || scopeSet.has('altoc.admin')
}

function apiV1Suffix(pathname: string) {
  const index = pathname.indexOf(API_PREFIX)
  if (index < 0) return ''
  return pathname.slice(index + API_PREFIX.length) || '/'
}

async function requireForwardedServiceCapability(event: H3Event) {
  const url = getRequestURL(event)
  const method = String(event.node.req.method || 'GET').toUpperCase()

  const requirement = serviceCapabilityRequirement(apiV1Suffix(url.pathname), method)
  if (!requirement) return

  const auth = await ensureAltocConsoleAuth(event) as ConsoleAuthContext | undefined
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
