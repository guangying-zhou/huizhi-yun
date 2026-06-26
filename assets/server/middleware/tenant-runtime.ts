import { createError, getRequestURL, type H3Event } from 'h3'
import { maybeProxyCurrentApiToTenantRuntime, type TenantRuntimeProxyContext } from '@hzy/foundation/server/utils/tenantRuntimeProxy'
import { ensureAssetsConsoleAuth } from '~~/server/utils/authIdentity'
import { requireServiceScope } from '~~/server/utils/serviceAuth'

const APP_CODE = 'assets'
const API_PREFIX = '/api/v1'

export default defineEventHandler(async (event) => {
  if (isApiV1Path(getRequestURL(event).pathname)) {
    await ensureAssetsConsoleAuth(event)
  }

  requireForwardedServiceCapability(event)

  const runtimeResponse = await maybeProxyCurrentApiToTenantRuntime(event, {
    appCode: APP_CODE,
    shouldForward: shouldForwardAssetsRuntime,
    resolveScope: scopeFor
  })

  if (runtimeResponse !== undefined) return runtimeResponse

  const pathname = getRequestURL(event).pathname
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

function shouldForwardAssetsRuntime(context: TenantRuntimeProxyContext) {
  if (/^\/service\/products(\/resolve-codes)?$/.test(context.suffix)) return false
  if (/^\/service\/customer-delivery-assets\/[^/]+\/activate$/.test(context.suffix)) return false
  if (context.method === 'GET' && /^\/products\/[^/]+\/versions$/.test(context.suffix)) return false
  return true
}

function isAllowedLocalApiV1Path(pathname: string) {
  const index = pathname.indexOf(API_PREFIX)
  if (index < 0) return false
  const apiPath = pathname.slice(index)
  return /^\/api\/v1\/service\/products(\/resolve-codes)?$/.test(apiPath)
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
  allowedApps: string[]
}

function apiV1Suffix(pathname: string) {
  const index = pathname.indexOf(API_PREFIX)
  if (index < 0) return ''
  return pathname.slice(index + API_PREFIX.length) || '/'
}

function serviceCapabilityRequirement(suffix: string, method: string): ServiceCapabilityRequirement | null {
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
    return { scope: 'assets:write', allowedApps: ['aims', 'assets'] }
  }
  return null
}

function requireForwardedServiceCapability(event: H3Event) {
  const url = getRequestURL(event)
  const method = String(event.node.req.method || 'GET').toUpperCase()
  const requirement = serviceCapabilityRequirement(apiV1Suffix(url.pathname), method)
  if (!requirement) return

  requireServiceScope(event, requirement)
}
