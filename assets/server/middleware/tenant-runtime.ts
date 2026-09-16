import { authorizeProductDocumentLink } from '~~/server/utils/productDocumentLinkAuthorization'
import { createError, getRequestURL, type H3Event } from 'h3'
import { maybeProxyCurrentApiToTenantRuntime, type TenantRuntimeProxyContext } from '@hzy/foundation/server/utils/tenantRuntimeProxy'
import { ensureAssetsConsoleAuth } from '~~/server/utils/authIdentity'
import { requireServiceScope } from '~~/server/utils/serviceAuth'
import { resolveAssetsApiPermission } from '~~/server/utils/assetsPermissionRoutes'
import { resolveAssetsObjectScopeQuery } from '~~/server/utils/assetsScopedAuthorization'
import { sanitizeAssetsObjectAccessRecord } from '~~/server/utils/assetsScopedAuthorizationCore'
import { handleProductAdoptionService } from '~~/server/utils/productAdoptionService'

const APP_CODE = 'assets'
const API_PREFIX = '/api/v1'

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname
  // Gateway 与 Service Binding 请求都保留 /assets base path，按 /api/v1 后缀匹配。
  if (apiV1Suffix(pathname) === '/service/product-adoption/read') return handleProductAdoptionService(event)
  if (isPublicLocalApiV1Path(pathname)) return

  if (isApiV1Path(pathname)) {
    await ensureAssetsConsoleAuth(event)
  }

  requireForwardedServiceCapability(event)

  const runtimeResponse = await maybeProxyCurrentApiToTenantRuntime(event, {
    appCode: APP_CODE,
    shouldForward: shouldForwardAssetsRuntime,
    resolveScope: scopeFor,
    resolveQuery: resolveAssetsRuntimeQuery
  })

  if (runtimeResponse !== undefined) return runtimeResponse

  if (isAllowedLocalApiV1Path(pathname)) return

  if (isApiV1Path(pathname)) {
    throw createError({
      statusCode: 503,
      message: 'Assets tenant-runtime is required for /api/v1 data access.'
    })
  }
})

function scopeFor(context: TenantRuntimeProxyContext) {
  return context.method === 'GET' ? 'assets.read' : 'assets.write'
}

async function resolveAssetsRuntimeQuery(
  context: TenantRuntimeProxyContext,
  input: Record<string, unknown>
) {
  const query = sanitizeAssetsObjectAccessRecord(input)
  for (const key of Object.keys(query)) {
    if (key.startsWith('current_user_product_document_')) Reflect.deleteProperty(query, key)
  }
  if (context.body) {
    for (const key of Object.keys(context.body)) {
      if (key.startsWith('current_user_product_document_')) Reflect.deleteProperty(context.body, key)
    }
  }
  delete query.current_user_product_target_access
  delete query.current_user_product_target_units
  if (context.body) {
    delete context.body.current_user_product_target_access
    delete context.body.current_user_product_target_units
  }
  if (context.body) {
    delete context.body.current_user_assets_object_access
    delete context.body.currentUserAssetsObjectAccess
    delete context.body.current_user_assets_scope_units
    delete context.body.currentUserAssetsScopeUnits
    delete context.body.current_user_assets_permission_action
    delete context.body.currentUserAssetsPermissionAction
  }
  const rule = resolveAssetsApiPermission(
    context.suffix,
    context.method,
    runtimeStatusFromContext(context),
    runtimeActionTypeFromContext(context),
    runtimeTargetTypeFromContext(context)
  )
  if (
    !context.currentUser
    || !rule
    || !['dashboard', 'asset_items', 'ip_assets', 'assignments', 'alerts', 'offboarding_recoveries', 'products'].includes(rule.resource)
    || rule.action === 'replay'
  ) return query

  Object.assign(query, await resolveAssetsObjectScopeQuery(
    context.event,
    context.currentUser,
    rule.resource,
    rule.action
  ))
  if (context.method === 'POST' && /^\/products\/[^/]+\/(?:assets|bases)$/.test(context.suffix)) {
    const targetResource = context.suffix.endsWith('/bases') ? 'technology_bases' : 'asset_items'
    const target = await resolveAssetsObjectScopeQuery(context.event, context.currentUser, targetResource, 'view')
    query.current_user_product_target_access = target.current_user_assets_object_access
    query.current_user_product_target_units = target.current_user_assets_scope_units || '[]'
  }
  const documentMatch = /^\/products\/([1-9]\d*)\/documents$/.exec(context.suffix)
  if (context.method === 'POST' && documentMatch) {
    Object.assign(query, await authorizeProductDocumentLink(context.event, documentMatch[1]!, context.body || {}, context.currentUser, query))
  }
  query.current_user_assets_permission_action = rule.action
  return query
}

function shouldForwardAssetsRuntime(context: TenantRuntimeProxyContext) {
  if (context.suffix === '/service/products/catalog') return false
  if (context.method === 'GET' && /^\/dictionaries\/?$/.test(context.suffix)) return false
  if (/^\/integration-operations(?:\/[^/]+\/(?:replay|attempts))?$/.test(context.suffix)) return false
  if (context.method === 'POST' && /^\/authorization\/instance-conflict-explain$/.test(context.suffix)) return false
  if (/^\/service\/products(\/resolve-codes)?$/.test(context.suffix)) return false
  if (context.method === 'POST' && context.suffix === '/service/notification-details/authorize') return false
  if (/^\/service\/customer-delivery-assets\/[^/]+\/activate$/.test(context.suffix)) return false
  if (context.method === 'GET' && /^\/products\/[^/]+\/versions$/.test(context.suffix)) return false
  if (context.suffix.startsWith('/service/')) return true
  return Boolean(resolveAssetsApiPermission(
    context.suffix,
    context.method,
    runtimeStatusFromContext(context),
    runtimeActionTypeFromContext(context),
    runtimeTargetTypeFromContext(context)
  ))
}

function runtimeActionTypeFromContext(context: TenantRuntimeProxyContext) {
  const body = context.body || {}
  return String(body.action_type || body.actionType || '')
}

function runtimeTargetTypeFromContext(context: TenantRuntimeProxyContext) {
  const body = context.body || {}
  return String(body.targetType || body.target_type || '')
}

function runtimeStatusFromContext(context: TenantRuntimeProxyContext) {
  const body = context.body || {}
  return String(
    body.status
    || body.workflowStatus
    || body.workflow_status
    || ''
  )
}

function isPublicLocalApiV1Path(pathname: string) {
  const index = pathname.indexOf(API_PREFIX)
  if (index < 0) return false
  const apiPath = pathname.slice(index)
  return /^\/api\/v1\/dictionaries\/?$/.test(apiPath)
    || /^\/api\/v1\/integration-operations(?:\/[^/]+\/(?:replay|attempts))?$/.test(apiPath)
}

function isAllowedLocalApiV1Path(pathname: string) {
  const index = pathname.indexOf(API_PREFIX)
  if (index < 0) return false
  const apiPath = pathname.slice(index)
  if (apiPath === '/api/v1/service/products/catalog') return true
  return /^\/api\/v1\/dictionaries\/?$/.test(apiPath)
    || /^\/api\/v1\/authorization\/instance-conflict-explain$/.test(apiPath)
    || /^\/api\/v1\/service\/products(\/resolve-codes)?$/.test(apiPath)
    || /^\/api\/v1\/service\/notification-details\/authorize$/.test(apiPath)
    || /^\/api\/v1\/service\/customer-delivery-assets\/[^/]+\/activate$/.test(apiPath)
    || /^\/api\/v1\/products\/[^/]+\/versions$/.test(apiPath)
}

function isApiV1Path(pathname: string) {
  const index = pathname.indexOf(API_PREFIX)
  if (index < 0) return false

  const after = pathname[index + API_PREFIX.length] || ''
  return after === '' || after === '/'
}

interface ServiceCapabilityRequirement {
  scope: string
  allowedApps?: string[]
}

function apiV1Suffix(pathname: string) {
  const index = pathname.indexOf(API_PREFIX)
  if (index < 0) return ''
  return pathname.slice(index + API_PREFIX.length) || '/'
}

function serviceCapabilityRequirement(suffix: string, method: string): ServiceCapabilityRequirement | null {
  if (method === 'GET' && suffix === '/service/products/catalog') return { scope: 'assets:product:read' }
  if (method === 'GET' && suffix === '/service/products') {
    return { scope: 'assets:read', allowedApps: ['aims', 'altoc'] }
  }
  if (method === 'GET' && suffix === '/service/deliveries/package') {
    return { scope: 'assets:read', allowedApps: ['altoc', 'aims', 'finance'] }
  }
  if (method === 'GET' && suffix === '/service/customer-delivery-assets/by-customer') {
    return { scope: 'assets:read', allowedApps: ['altoc', 'aims', 'finance'] }
  }
  if (method === 'GET' && /^\/service\/customer-delivery-assets\/by-contract\/[^/]+$/.test(suffix)) {
    return { scope: 'assets:read', allowedApps: ['altoc', 'aims', 'finance'] }
  }
  if (method === 'GET' && /^\/service\/customer-delivery-assets\/[^/]+\/environments$/.test(suffix)) {
    return { scope: 'assets:read', allowedApps: ['altoc', 'aims', 'finance'] }
  }
  if (method === 'GET' && /^\/service\/environments\/[^/]+(\/customer-delivery-assets)?$/.test(suffix)) {
    return { scope: 'assets:read', allowedApps: ['altoc', 'aims', 'finance'] }
  }
  if (method === 'GET' && /^\/service\/projects\/[^/]+\/cost-summary$/.test(suffix)) {
    return { scope: 'assets:read', allowedApps: ['finance'] }
  }
  if (method !== 'POST') return null

  if (suffix === '/service/notification-details/authorize') {
    return { scope: 'assets:notification-details:authorize', allowedApps: ['console'] }
  }

  if (suffix === '/service/offboarding-recoveries:upsert') {
    return { scope: 'assets:offboarding-recovery:sync', allowedApps: ['people'] }
  }

  if (suffix === '/service/deliveries/upsert') {
    return { scope: 'assets:write', allowedApps: ['aims', 'altoc'] }
  }
  if (suffix === '/service/customer-delivery-assets/plans') {
    return { scope: 'assets:write', allowedApps: ['altoc'] }
  }
  if (suffix === '/service/environments/upsert') {
    return { scope: 'assets:write', allowedApps: ['aims', 'altoc'] }
  }
  if (suffix === '/service/references:resolve') {
    return { scope: 'assets:read', allowedApps: ['aims', 'altoc', 'finance'] }
  }
  if (suffix === '/service/products/resolve-codes') {
    return { scope: 'assets:read', allowedApps: ['aims'] }
  }
  if (/^\/service\/environments\/[^/]+\/lifecycle:sync$/.test(suffix)) {
    return { scope: 'assets:write', allowedApps: ['aims', 'altoc'] }
  }
  if (/^\/service\/customer-delivery-assets\/[^/]+\/environments:bind$/.test(suffix)) {
    return { scope: 'assets:write', allowedApps: ['aims', 'altoc'] }
  }
  if (/^\/service\/customer-delivery-assets\/[^/]+\/activate$/.test(suffix)) {
    return { scope: 'assets:write', allowedApps: ['altoc', 'aims'] }
  }
  if (/^\/service\/deliveries\/[^/]+\/documents$/.test(suffix)) {
    return { scope: 'assets:write', allowedApps: ['aims', 'altoc', 'assets'] }
  }
  return null
}

function requireForwardedServiceCapability(event: H3Event) {
  const url = getRequestURL(event)
  const method = String(event.node.req.method || 'GET').toUpperCase()
  const suffix = apiV1Suffix(url.pathname)
  const requirement = serviceCapabilityRequirement(suffix, method)
  if (!requirement) {
    if (suffix.startsWith('/service/')) {
      throw createError({
        statusCode: 403,
        message: 'Unsupported Assets service endpoint capability.'
      })
    }
    return
  }

  requireServiceScope(event, requirement)
}
