import { defineEventHandler, getHeader, getMethod, getQuery, getRequestURL, readBody, setResponseHeader } from 'h3'
import { extractTenantCodeFromPayload, getTenantContextCode, parseBooleanLike, parseCsvSet, requireAuthenticated } from '~~/server/utils/access'
import type { RowDataPacket } from 'mysql2/promise'
import { queryRow } from '~~/server/utils/db'
import { ensureOpsRbacReady, hasOpsPermission } from '~~/server/utils/platformOpsRbac'
import { isRuntimeContractPath, requireRuntimeAccess } from '~~/server/utils/runtimeAuth'
import { requireActiveTenantMembership } from '~~/server/utils/tenantAccounts'

const OPS_PREFIX = '/api/platform/ops/'
const TENANT_ADMIN_PREFIX = '/api/platform/tenant-admin/'
const LEGACY_ADMIN_PREFIX = '/api/platform/admin/'
const LEGACY_RUNTIME_PREFIX = '/api/platform/runtime/'
const INTERNAL_PREFIX = '/api/platform/internal/'
const V1_PREFIX = '/api/v1/'
const V1_INTERNAL_PREFIX = '/api/v1/internal/'
const LEGACY_DEPRECATION_MESSAGE = '/api/platform/admin is deprecated; use /api/platform/ops'
const RUNTIME_DEPRECATION_MESSAGE = '/api/platform/runtime is deprecated; use /api/v1'

type EventWithAccessContext = Parameters<typeof defineEventHandler>[0] extends (event: infer T) => unknown ? T : never
type CloudflareRuntimeEnv = {
  [key: string]: unknown
}

function normalizeTenantCode(value: unknown) {
  return String(value || '').trim()
}

function cloudflareEnvValue(event: EventWithAccessContext, name: string) {
  const context = event.context as typeof event.context & {
    cloudflare?: {
      env?: CloudflareRuntimeEnv
    }
  }
  const value = context.cloudflare?.env?.[name] || globalThis.__hzyCloudflareEnv?.[name]
  return typeof value === 'string' ? value.trim() : ''
}

function runtimeSecurityCsvValue(event: EventWithAccessContext, configValue: unknown, envNames: string[]) {
  const values: string[] = []
  const configured = normalizeTenantCode(configValue)
  if (configured) values.push(configured)

  for (const name of envNames) {
    const value = cloudflareEnvValue(event, name) || normalizeTenantCode(process.env[name])
    if (value) values.push(value)
  }

  return values.join(',')
}

function resolveInternalServiceToken(event: EventWithAccessContext) {
  const headerToken = normalizeTenantCode(
    getHeader(event, 'x-hzy-internal-token') || getHeader(event, 'x-platform-internal-token')
  )
  if (headerToken) {
    return headerToken
  }

  const authorization = normalizeTenantCode(getHeader(event, 'authorization'))
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim()
  }

  return ''
}

function shouldParseBody(method: string, contentType: string) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return false
  }

  return contentType.includes('application/json')
}

function setDeprecationHeaders(event: EventWithAccessContext, message: string) {
  const runtimeConfig = useRuntimeConfig()
  const sunsetAt = String(runtimeConfig.security?.platformApiSunsetAt || '2026-07-31T23:59:59Z')
  setResponseHeader(event, 'Deprecation', 'true')
  setResponseHeader(event, 'Sunset', sunsetAt)
  setResponseHeader(event, 'x-platform-api-deprecated', message)
}

async function resolveTenantCodeByPath(path: string) {
  const patterns: Array<{ regex: RegExp, sql: string }> = [
    {
      regex: /^\/api\/platform\/tenant-admin\/users\/(\d+)(?:\/|$)/,
      sql: `SELECT tenant_code
            FROM tenant_subjects
            WHERE id = ?
              AND subject_type = 'user'
            LIMIT 1`
    },
    {
      regex: /^\/api\/platform\/tenant-admin\/subjects\/(\d+)(?:\/|$)/,
      sql: 'SELECT tenant_code FROM tenant_subjects WHERE id = ? LIMIT 1'
    },
    {
      regex: /^\/api\/platform\/tenant-admin\/subject-roles\/(\d+)(?:\/|$)/,
      sql: 'SELECT tenant_code FROM tenant_subject_roles WHERE id = ? LIMIT 1'
    },
    {
      regex: /^\/api\/platform\/tenant-admin\/roles\/(\d+)(?:\/|$)/,
      sql: 'SELECT tenant_code FROM tenant_roles WHERE id = ? LIMIT 1'
    },
    {
      regex: /^\/api\/platform\/tenant-admin\/templates\/(\d+)(?:\/|$)/,
      sql: 'SELECT tenant_code FROM tenant_permission_templates WHERE id = ? LIMIT 1'
    },
    {
      regex: /^\/api\/platform\/tenant-admin\/tenants\/(\d+)(?:\/|$)/,
      sql: 'SELECT tenant_code FROM tenants WHERE id = ? LIMIT 1'
    },
    {
      regex: /^\/api\/platform\/tenant-admin\/deployments\/(\d+)(?:\/|$)/,
      sql: 'SELECT tenant_code FROM deployments WHERE id = ? LIMIT 1'
    },
    {
      regex: /^\/api\/platform\/tenant-admin\/licenses\/(\d+)(?:\/|$)/,
      sql: 'SELECT tenant_code FROM licenses WHERE id = ? LIMIT 1'
    }
  ]

  for (const pattern of patterns) {
    const match = path.match(pattern.regex)
    if (!match) {
      continue
    }

    const id = Number(match[1])
    if (!Number.isInteger(id) || id <= 0) {
      return ''
    }

    const row = await queryRow<RowDataPacket>(
      pattern.sql,
      [id]
    )

    return String(row?.tenant_code || '').trim()
  }

  return ''
}

export default defineEventHandler(async (event: EventWithAccessContext) => {
  const path = getRequestURL(event).pathname
  const method = getMethod(event).toUpperCase()

  if (path.startsWith(V1_INTERNAL_PREFIX)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: '/api/v1/internal is not part of the public API contract'
    })
  }

  if (path.startsWith(V1_PREFIX)) {
    if (isRuntimeContractPath(path)) {
      await requireRuntimeAccess(event, path)
      event.context.platformAccessScope = 'runtime'
      return
    }

    event.context.platformAccessScope = 'contract'
    return
  }

  if (path.startsWith(LEGACY_RUNTIME_PREFIX)) {
    setDeprecationHeaders(event, RUNTIME_DEPRECATION_MESSAGE)
    await requireRuntimeAccess(event, path)
    event.context.platformAccessScope = 'runtime'
    return
  }

  if (
    !path.startsWith(OPS_PREFIX)
    && !path.startsWith(TENANT_ADMIN_PREFIX)
    && !path.startsWith(LEGACY_ADMIN_PREFIX)
    && !path.startsWith(INTERNAL_PREFIX)
  ) {
    return
  }

  const runtimeConfig = useRuntimeConfig()
  const securityConfig = runtimeConfig.security || {}

  if (path.startsWith(INTERNAL_PREFIX)) {
    const internalTokens = parseCsvSet(runtimeSecurityCsvValue(event, securityConfig.internalServiceTokens || securityConfig.internalServiceToken, [
      'HZY_CLOUDFLARE_INTERNAL_TOKEN',
      'PLATFORM_INTERNAL_SERVICE_TOKENS',
      'PLATFORM_INTERNAL_SERVICE_TOKEN'
    ]))
    if (internalTokens.size === 0) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Service Unavailable',
        message: 'internal API is not configured: security.internalServiceTokens is empty'
      })
    }

    const internalToken = resolveInternalServiceToken(event)
    if (!internalToken || !internalTokens.has(internalToken)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        message: 'internal access denied: invalid service token'
      })
    }

    event.context.platformAccessScope = 'internal'
    event.context.platformInternalPrincipal = normalizeTenantCode(
      getHeader(event, 'x-hzy-internal-principal') || getHeader(event, 'x-platform-internal-principal') || 'internal-service'
    )
    return
  }

  if (path.startsWith(OPS_PREFIX) || path.startsWith(LEGACY_ADMIN_PREFIX)) {
    const auth = await requireAuthenticated(event, { scope: 'platform_admin' })
    const { uid } = auth
    const opsAllowlist = parseCsvSet(securityConfig.opsUids)
    const bootstrapUids = parseCsvSet(securityConfig.opsBootstrapUids)
    const enableOpsRbac = parseBooleanLike(securityConfig.enableOpsRbac, true)
    const allowOpsUidFallback = parseBooleanLike(securityConfig.allowOpsUidFallback, true)
    let granted = false

    if (enableOpsRbac) {
      await ensureOpsRbacReady([...bootstrapUids])
      granted = await hasOpsPermission(uid, path, method)
    }

    if (!granted && allowOpsUidFallback) {
      granted = opsAllowlist.has(uid)
    }

    if (!granted) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        message: `ops access denied for uid=${uid}`
      })
    }

    if (path.startsWith(LEGACY_ADMIN_PREFIX)) {
      setDeprecationHeaders(event, LEGACY_DEPRECATION_MESSAGE)

      const allowLegacyAdminApi = parseBooleanLike(securityConfig.allowLegacyAdminApi, false)
      if (!allowLegacyAdminApi) {
        throw createError({
          statusCode: 410,
          statusMessage: 'Gone',
          message: LEGACY_DEPRECATION_MESSAGE
        })
      }
    }

    event.context.platformAccessScope = 'ops'
    event.context.platformUid = uid
    return
  }

  const auth = await requireAuthenticated(event, { scope: 'tenant_admin' })
  const { uid } = auth

  const queryTenantCode = normalizeTenantCode(getQuery(event).tenantCode)
  const { headerTenantCode, cookieTenantCode, effectiveTenantCode: contextTenantCode } = getTenantContextCode(event)
  const effectiveTenantCode = contextTenantCode || queryTenantCode
  if (!effectiveTenantCode) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'tenant context is missing (x-hzy-tenant-code, hzy-current-tenant, or tenantCode query)'
    })
  }

  if (headerTenantCode && cookieTenantCode && headerTenantCode !== cookieTenantCode) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'tenant context mismatch between header and cookie'
    })
  }

  if (queryTenantCode && queryTenantCode !== effectiveTenantCode) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: `tenant query mismatch: ${queryTenantCode} !== ${effectiveTenantCode}`
    })
  }

  const contentType = String(event.node.req.headers['content-type'] || '').toLowerCase()
  if (shouldParseBody(method, contentType)) {
    const body = await readBody<Record<string, unknown> | null>(event).catch(() => null)
    const bodyTenantCode = extractTenantCodeFromPayload(body)

    if (bodyTenantCode && bodyTenantCode !== effectiveTenantCode) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
        message: `tenant body mismatch: ${bodyTenantCode} !== ${effectiveTenantCode}`
      })
    }
  }

  if (path.startsWith('/api/platform/tenant-admin/applications') && method !== 'GET') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: 'tenant-admin cannot mutate platform applications'
    })
  }

  const pathTenantCode = await resolveTenantCodeByPath(path)
  if (pathTenantCode && pathTenantCode !== effectiveTenantCode) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      message: `tenant resource mismatch: ${pathTenantCode} !== ${effectiveTenantCode}`
    })
  }

  const membership = await requireActiveTenantMembership(auth, effectiveTenantCode)

  event.context.platformAccessScope = 'tenant-admin'
  event.context.platformUid = uid
  event.context.platformAccountId = membership.account.accountId
  event.context.platformTenantCode = effectiveTenantCode
  event.context.platformTenantMembership = membership
})
