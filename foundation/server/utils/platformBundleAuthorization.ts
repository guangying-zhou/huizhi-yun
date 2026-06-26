import {
  getConsoleRuntimeConfig,
  resolveConsoleRuntimeSeedConfig,
  resolveTenantGatewayConsoleOrigin
} from './consoleRuntime'
import { loadHzyLocalDevRuntimeMode } from './localDevRuntime'
import { createError, getHeader, getRequestURL, type H3Event } from 'h3'
import type {
  FoundationObjectContext,
  FoundationScopedAuthorizationDecision,
  FoundationScopedAuthorizationGrant
} from './scopeEvaluator'

export interface RuntimePermissionInput {
  appCode?: string
  resourceCode?: string
  action?: string
  actions?: string[]
}

export interface RuntimeAuthorizationRole {
  roleCode: string
  roleName: string
  roleType: string
  appCode: string | null
  sources?: string[]
}

export interface RuntimeAuthorizationSnapshot {
  uid: string
  roles: string[]
  availableRoles: RuntimeAuthorizationRole[]
  activeRoleCode: string
  authorizationMode?: string
  permissions: Array<{
    appCode: string
    resourceCode: string
    action: string
  }>
  resources: Record<string, string[]>
  bundleVersion: string
  bundleHash?: string
}

export interface RuntimeScopedAuthorizationSnapshot {
  uid: string
  appCode: string
  roles: string[]
  availableRoles: RuntimeAuthorizationRole[]
  activeRoleCode: string
  authorizationMode?: string
  bundleVersion: string
  bundleHash?: string
  grants: FoundationScopedAuthorizationGrant[]
  decision?: FoundationScopedAuthorizationDecision
}

export interface AuthorizationManifestResource {
  code?: unknown
  actions?: unknown
  supportedActions?: unknown
}

export interface LoadAuthorizationFromPlatformBundleOptions {
  localDev?: {
    enabled?: boolean
    resources: readonly AuthorizationManifestResource[]
    roleCode?: string
    roleName?: string
    fallbackActions?: string[]
  }
  globalAdminExpansion?: {
    resources: readonly AuthorizationManifestResource[]
    roleCode?: string
    actions?: string[]
    adminRoleCodes?: string[]
  }
}

export interface LoadScopedAuthorizationFromConsoleOptions {
  activeRoleCode?: string | null
  authorizationMode?: string | null
  resourceCode?: string | null
  action?: string | null
  object?: FoundationObjectContext | null
}

interface ConsoleAuthorizationEnvelope {
  code?: number
  data?: {
    uid?: string
    roles?: string[]
    availableRoles?: RuntimeAuthorizationRole[]
    activeRoleCode?: string | null
    authorizationMode?: string | null
    resources?: Record<string, string[]>
    bundleVersion?: string | null
    bundleHash?: string | null
  }
  message?: string
}

interface ConsoleScopedAuthorizationEnvelope {
  code?: number
  data?: RuntimeScopedAuthorizationSnapshot
  message?: string
}

interface ConsoleAuthContext {
  authenticated?: boolean
  token?: string
  tokenUse?: string
  subjectType?: string
}

interface ConsoleRuntimeHeaderContext {
  tenant?: {
    tenantCode?: string | null
  }
}

type CloudflareRuntimeEnv = Record<string, unknown>
type CloudflareRuntimeEvent = H3Event & {
  context?: {
    cloudflare?: {
      env?: CloudflareRuntimeEnv
    }
    _platform?: {
      cloudflare?: {
        env?: CloudflareRuntimeEnv
      }
    }
    nitro?: {
      env?: CloudflareRuntimeEnv
    }
  }
  req?: {
    runtime?: {
      cloudflare?: {
        env?: CloudflareRuntimeEnv
      }
    }
  }
}

type CloudflareGlobal = typeof globalThis & {
  __env__?: CloudflareRuntimeEnv
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function getCloudflareEnv(event: H3Event) {
  const runtimeEvent = event as CloudflareRuntimeEvent
  return runtimeEvent.context?.cloudflare?.env
    || runtimeEvent.context?._platform?.cloudflare?.env
    || runtimeEvent.context?.nitro?.env
    || runtimeEvent.req?.runtime?.cloudflare?.env
    || (globalThis as CloudflareGlobal).__env__
    || {}
}

function runtimeEnvValue(event: H3Event, ...keys: string[]) {
  const cloudflareEnv = getCloudflareEnv(event)
  for (const key of keys) {
    const value = stringValue(cloudflareEnv[key] || process.env[key])
    if (value) return value
  }
  return ''
}

function internalGatewayToken(event: H3Event) {
  return runtimeEnvValue(
    event,
    'HZY_CLOUDFLARE_INTERNAL_TOKEN',
    'HZY_TENANT_GATEWAY_INTERNAL_TOKEN',
    'HZY_CONSOLE_PLATFORM_SERVICE_TOKEN'
  )
}

function hasConsoleRuntimeEnv(event: H3Event) {
  return Boolean(runtimeEnvValue(
    event,
    'HZY_CONSOLE_RUNTIME_API_URL',
    'HZY_CONSOLE_API_URL',
    'HZY_CONSOLE_URL',
    'NUXT_PUBLIC_CONSOLE_URL'
  ))
}

function getConsoleAccessToken(event: H3Event) {
  const consoleAuth = event.context.consoleAuth as ConsoleAuthContext | undefined
  const token = stringValue(consoleAuth?.token)
  if (
    consoleAuth?.authenticated
    && token
    && consoleAuth.tokenUse !== 'legacy_session'
    && consoleAuth.subjectType !== 'service'
  ) {
    return token
  }

  return ''
}

function getRequestProtocol(event: H3Event) {
  const forwardedProto = stringValue(getHeader(event, 'x-forwarded-proto')).split(',')[0]?.trim()
  if (forwardedProto) {
    return forwardedProto.replace(/:$/, '')
  }

  return getRequestURL(event).protocol.replace(/:$/, '') || 'http'
}

function getRequestHost(event: H3Event) {
  return stringValue(getHeader(event, 'x-forwarded-host')).split(',')[0]?.trim()
    || stringValue(getHeader(event, 'host')).split(',')[0]?.trim()
    || getRequestURL(event).host
}

function consoleAuthorizationForwardHeaders(event: H3Event, runtime?: ConsoleRuntimeHeaderContext) {
  const headers: Record<string, string> = {}

  // Do not forward x-hzy-deployment here: Tenant Gateway sets it to the
  // business app deployment, while Console validates policy bundles in its own
  // tenant/runtime context.
  for (const name of [
    'x-hzy-gateway',
    'x-hzy-gateway-token',
    'x-hzy-tenant',
    'x-hzy-environment',
    'x-forwarded-port',
    'x-forwarded-prefix'
  ]) {
    const value = stringValue(getHeader(event, name))
    if (value) headers[name] = value
  }

  const forwardedProto = stringValue(getHeader(event, 'x-forwarded-proto')) || getRequestProtocol(event)
  const forwardedHost = stringValue(getHeader(event, 'x-forwarded-host')) || getRequestHost(event)
  if (forwardedProto) {
    headers['x-forwarded-proto'] = forwardedProto
  }
  if (forwardedHost) {
    headers['x-forwarded-host'] = forwardedHost
  }

  const runtimeTenantCode = stringValue(runtime?.tenant?.tenantCode)
  if (runtimeTenantCode && !headers['x-hzy-tenant']) {
    headers['x-hzy-tenant'] = runtimeTenantCode
  }

  const configuredGatewayToken = internalGatewayToken(event)
  if (configuredGatewayToken && (isTenantGatewayContext(event) || headers['x-hzy-tenant'])) {
    headers['x-hzy-gateway'] = 'tenant-gateway'
    headers['x-hzy-gateway-token'] = configuredGatewayToken
  }

  return headers
}

function isTenantGatewayContext(event: H3Event) {
  return stringValue(getHeader(event, 'x-hzy-gateway')).toLowerCase() === 'tenant-gateway'
    || Boolean(stringValue(getHeader(event, 'x-hzy-tenant')))
}

function uniqueBaseUrls(urls: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const url of urls.map(item => item.replace(/\/+$/, '')).filter(Boolean)) {
    if (seen.has(url)) continue
    seen.add(url)
    result.push(url)
  }
  return result
}

function consoleAuthorizationBaseUrls(
  event: H3Event,
  tenantGatewayBaseUrl: string,
  runtimeBaseUrl: string,
  serverBaseUrl: string,
  preferServerBaseUrl: boolean
) {
  if (isTenantGatewayContext(event) && preferServerBaseUrl && serverBaseUrl) {
    return uniqueBaseUrls([serverBaseUrl, runtimeBaseUrl])
  }

  return isTenantGatewayContext(event)
    ? uniqueBaseUrls([tenantGatewayBaseUrl, runtimeBaseUrl, serverBaseUrl])
    : uniqueBaseUrls([serverBaseUrl, runtimeBaseUrl])
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const data = error && typeof error === 'object'
    ? (error as { data?: { data?: { reason?: unknown }, message?: unknown, statusMessage?: unknown } }).data
    : undefined
  const reason = stringValue(data?.data?.reason) || stringValue(data?.message) || stringValue(data?.statusMessage)
  return reason ? `${message} (${reason})` : message
}

function appMatches(appCode: unknown, targetAppCode: string) {
  const normalized = stringValue(appCode)
  return !normalized || normalized === targetAppCode
}

const DEFAULT_GLOBAL_ADMIN_ROLE_CODES = [
  'console:console-dev-admin',
  'console:admin',
  'system_admin',
  'platform:admin',
  'super_admin'
]

function manifestResourceActions(resource: AuthorizationManifestResource, fallbackActions: string[] = []) {
  const rawActions = Array.isArray(resource.actions) ? resource.actions : resource.supportedActions
  const actions = Array.isArray(rawActions)
    ? rawActions.map(action => stringValue(action)).filter(Boolean)
    : []
  return actions.length > 0 ? actions : fallbackActions
}

function buildResourceMapFromManifestResources(
  resources: readonly AuthorizationManifestResource[],
  fallbackActions: string[] = []
) {
  return Object.fromEntries(
    resources
      .map(resource => [stringValue(resource.code), manifestResourceActions(resource, fallbackActions)] as const)
      .filter(([resourceCode, actions]) => Boolean(resourceCode) && actions.length > 0)
  )
}

function buildPermissionsFromResources(targetAppCode: string, resources: Record<string, string[]>) {
  return Object.entries(resources).flatMap(([resourceCode, actions]) =>
    actions.map(action => ({
      appCode: targetAppCode,
      resourceCode,
      action
    }))
  )
}

function buildLocalDevAuthorizationSnapshot(
  uid: string,
  targetAppCode: string,
  localDev: NonNullable<LoadAuthorizationFromPlatformBundleOptions['localDev']>
): RuntimeAuthorizationSnapshot {
  const roleCode = stringValue(localDev.roleCode) || `${targetAppCode}:local-dev-admin`
  const resources = buildResourceMapFromManifestResources(localDev.resources, localDev.fallbackActions || [])

  return {
    uid,
    roles: [roleCode],
    availableRoles: [{
      roleCode,
      roleName: stringValue(localDev.roleName) || 'Local Dev Admin',
      roleType: 'dev',
      appCode: targetAppCode,
      sources: ['dev']
    }],
    activeRoleCode: roleCode,
    permissions: buildPermissionsFromResources(targetAppCode, resources),
    resources,
    bundleVersion: 'local-dev'
  }
}

function shouldUseLocalDevAuthorization(event: H3Event | undefined, localDev: LoadAuthorizationFromPlatformBundleOptions['localDev']) {
  if (!localDev) return false
  return localDev.enabled ?? loadHzyLocalDevRuntimeMode(event).runtimeBypassEnabled
}

export function normalizeAuthorizationResources(
  permissions: RuntimePermissionInput[] = [],
  targetAppCode: string
) {
  const resourceMap = new Map<string, Set<string>>()

  for (const permission of permissions) {
    if (!appMatches(permission.appCode, targetAppCode)) continue

    const resourceCode = stringValue(permission.resourceCode)
    if (!resourceCode) continue

    const actions = Array.isArray(permission.actions)
      ? permission.actions.map(action => stringValue(action)).filter(Boolean)
      : [stringValue(permission.action)].filter(Boolean)

    if (!actions.length) continue

    const existing = resourceMap.get(resourceCode) || new Set<string>()
    for (const action of actions) {
      existing.add(action)
    }
    resourceMap.set(resourceCode, existing)
  }

  return Object.fromEntries(
    [...resourceMap.entries()].map(([resourceCode, actions]) => [resourceCode, [...actions].sort()])
  )
}

function hasGlobalAdminRole(roles: Iterable<string>, adminRoleCodes: string[]) {
  const allowed = new Set(adminRoleCodes.map(role => stringValue(role)).filter(Boolean))
  const roleSet = new Set([...roles].map(role => stringValue(role)).filter(Boolean))
  return [...allowed].some(roleCode => roleSet.has(roleCode))
}

function expandGlobalAdminAuthorization(
  snapshot: RuntimeAuthorizationSnapshot,
  targetAppCode: string,
  expansion: LoadAuthorizationFromPlatformBundleOptions['globalAdminExpansion']
): RuntimeAuthorizationSnapshot {
  if (!expansion) return snapshot
  if (!hasGlobalAdminRole(snapshot.roles, expansion.adminRoleCodes || DEFAULT_GLOBAL_ADMIN_ROLE_CODES)) {
    return snapshot
  }

  const resources: Record<string, string[]> = Object.fromEntries(
    Object.entries(snapshot.resources).map(([resourceCode, actions]) => [resourceCode, [...actions]])
  )
  const expansionActions = expansion.actions || ['admin', 'edit', 'view']

  for (const [resourceCode, actions] of Object.entries(buildResourceMapFromManifestResources(expansion.resources, expansionActions))) {
    const actionSet = new Set([...(resources[resourceCode] || []), ...actions])
    resources[resourceCode] = [...actionSet].sort()
  }

  const roleCode = stringValue(expansion.roleCode) || `${targetAppCode}:admin`
  const roles = [...new Set([...snapshot.roles, roleCode])].sort()

  return {
    ...snapshot,
    roles,
    activeRoleCode: snapshot.activeRoleCode || roles[0] || '',
    permissions: buildPermissionsFromResources(targetAppCode, resources),
    resources
  }
}

export async function loadAuthorizationSnapshotFromConsoleRuntime(
  uid: string,
  targetAppCode: string,
  event: H3Event,
  options: LoadAuthorizationFromPlatformBundleOptions = {}
): Promise<RuntimeAuthorizationSnapshot> {
  if (shouldUseLocalDevAuthorization(event, options.localDev)) {
    return buildLocalDevAuthorizationSnapshot(uid, targetAppCode, options.localDev!)
  }

  const consoleSnapshot = await loadAuthorizationFromConsoleRuntime(event, uid, targetAppCode)
  if (consoleSnapshot) {
    return expandGlobalAdminAuthorization(consoleSnapshot, targetAppCode, options.globalAdminExpansion)
  }

  throw createError({
    statusCode: 503,
    statusMessage: 'Authorization Unavailable',
    message: 'Console authorization unavailable; business applications no longer fall back to local policy bundle'
  })
}

export async function loadAuthorizationFromCachedPlatformBundle(
  uid: string,
  targetAppCode: string,
  event?: H3Event,
  options: LoadAuthorizationFromPlatformBundleOptions = {}
): Promise<RuntimeAuthorizationSnapshot | null> {
  if (event) {
    return loadAuthorizationSnapshotFromConsoleRuntime(uid, targetAppCode, event, options)
  }

  if (shouldUseLocalDevAuthorization(undefined, options.localDev)) {
    return buildLocalDevAuthorizationSnapshot(uid, targetAppCode, options.localDev!)
  }

  console.warn('[PlatformAuthorization] loadAuthorizationFromCachedPlatformBundle called without request context; local policy bundle fallback is disabled')
  return null
}

export async function listUserCodesByRoleFromCachedPlatformBundle(
  roleCode: string,
  _targetAppCode: string
): Promise<string[]> {
  const normalizedRoleCode = stringValue(roleCode)
  if (!normalizedRoleCode) return []

  console.warn(`[PlatformAuthorization] listUserCodesByRoleFromCachedPlatformBundle(${normalizedRoleCode}) is disabled; use Console authorization directory API`)
  return []
}

async function loadAuthorizationFromConsoleRuntime(
  event: H3Event,
  uid: string,
  targetAppCode: string
): Promise<RuntimeAuthorizationSnapshot | null> {
  try {
    const runtime = await getConsoleRuntimeConfig({ event })
    const seed = resolveConsoleRuntimeSeedConfig(undefined, event)
    const baseUrls = consoleAuthorizationBaseUrls(
      event,
      stringValue(resolveTenantGatewayConsoleOrigin(event)),
      stringValue(runtime.console.baseUrl),
      stringValue(seed.consoleApiUrl),
      Boolean(internalGatewayToken(event))
    )
    if (!baseUrls.length) return null
    const hasInternalToken = Boolean(internalGatewayToken(event))
    const hasConsoleEnv = hasConsoleRuntimeEnv(event)

    const accessToken = getConsoleAccessToken(event)
    const cookie = stringValue(getHeader(event, 'cookie'))
    const headers: Record<string, string> = consoleAuthorizationForwardHeaders(event, runtime)
    if (accessToken) {
      headers.authorization = `Bearer ${accessToken}`
    } else if (cookie) {
      headers.cookie = cookie
    }

    let lastError: unknown = null
    for (const baseUrl of baseUrls) {
      try {
        const response = await $fetch<ConsoleAuthorizationEnvelope>(
          `${baseUrl}${accessToken ? '/api/v1/console/user/permissions' : '/api/auth/permissions'}`,
          {
            query: { appCode: targetAppCode },
            headers: Object.keys(headers).length ? headers : undefined,
            timeout: 10000
          }
        )

        if (response.code !== undefined && response.code !== 0) {
          console.warn(`[PlatformAuthorization] Console authorization response rejected: baseUrl=${baseUrl}, code=${response.code}, message=${response.message || 'invalid response'}`)
          lastError = new Error(response.message || 'Console authorization response is invalid')
          continue
        }

        const data = response.data
        if (!data?.resources || typeof data.resources !== 'object') {
          console.warn(`[PlatformAuthorization] Console authorization response missing resources: baseUrl=${baseUrl}`)
          lastError = new Error('Console authorization response missing resources')
          continue
        }

        const resources = normalizeAuthorizationResources(
          Object.entries(data.resources).flatMap(([resourceCode, actions]) =>
            (Array.isArray(actions) ? actions : []).map(action => ({
              appCode: targetAppCode,
              resourceCode,
              action
            }))
          ),
          targetAppCode
        )
        const permissions = Object.entries(resources).flatMap(([resourceCode, actions]) =>
          actions.map(action => ({
            appCode: targetAppCode,
            resourceCode,
            action
          }))
        )
        if (!permissions.length) {
          console.warn(`[PlatformAuthorization] Console authorization returned empty resources: uid=${stringValue(data.uid) || uid}, appCode=${targetAppCode}, baseUrl=${baseUrl}, roles=${Array.isArray(data.roles) ? data.roles.length : 0}`)
        }

        return {
          uid: stringValue(data.uid) || uid,
          roles: Array.isArray(data.roles) ? data.roles.map(role => stringValue(role)).filter(Boolean).sort() : [],
          availableRoles: Array.isArray(data.availableRoles) ? data.availableRoles : [],
          activeRoleCode: stringValue(data.activeRoleCode) || stringValue(data.roles?.[0]),
          authorizationMode: stringValue(data.authorizationMode) || undefined,
          permissions,
          resources,
          bundleVersion: stringValue(data.bundleVersion) || stringValue(runtime.bundle?.bundleVersion) || 'console-runtime',
          bundleHash: stringValue(data.bundleHash) || undefined
        }
      } catch (error) {
        console.warn(`[PlatformAuthorization] Console authorization request failed: baseUrl=${baseUrl}, error=${errorMessage(error)}`)
        lastError = error
      }
    }

    if (lastError) {
      console.warn(`[PlatformAuthorization] Console authorization failed: baseUrls=${baseUrls.join(',')}, internalToken=${hasInternalToken ? 'present' : 'missing'}, consoleEnv=${hasConsoleEnv ? 'present' : 'missing'}, lastError=${errorMessage(lastError)}`)
      throw lastError
    }
  } catch (error) {
    console.warn(`[PlatformAuthorization] Console authorization unavailable: ${errorMessage(error)}`)
    return null
  }

  return null
}

export async function loadScopedAuthorizationFromConsoleRuntime(
  event: H3Event,
  uid: string,
  targetAppCode: string,
  options: LoadScopedAuthorizationFromConsoleOptions = {}
): Promise<RuntimeScopedAuthorizationSnapshot> {
  const runtime = await getConsoleRuntimeConfig({ event })
  const seed = resolveConsoleRuntimeSeedConfig(undefined, event)
  const baseUrls = consoleAuthorizationBaseUrls(
    event,
    stringValue(resolveTenantGatewayConsoleOrigin(event)),
    stringValue(runtime.console.baseUrl),
    stringValue(seed.consoleApiUrl),
    Boolean(internalGatewayToken(event))
  )
  if (!baseUrls.length) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Authorization Unavailable',
      message: 'Console authorization runtime is not configured'
    })
  }

  const accessToken = getConsoleAccessToken(event)
  const cookie = stringValue(getHeader(event, 'cookie'))
  const headers: Record<string, string> = consoleAuthorizationForwardHeaders(event, runtime)
  if (accessToken) {
    headers.authorization = `Bearer ${accessToken}`
  }
  if (cookie) {
    headers.cookie = cookie
  }

  let lastError: unknown = null
  for (const baseUrl of baseUrls) {
    try {
      const response = await $fetch<ConsoleScopedAuthorizationEnvelope>(
        `${baseUrl}${accessToken ? '/api/v1/console/user/scoped-authorization' : '/api/auth/scoped-authorization'}`,
        {
          method: 'POST',
          body: {
            appCode: targetAppCode,
            activeRoleCode: options.activeRoleCode || undefined,
            authorizationMode: options.authorizationMode || undefined,
            resourceCode: options.resourceCode || undefined,
            action: options.action || undefined,
            object: options.object || undefined
          },
          headers: Object.keys(headers).length ? headers : undefined,
          timeout: 10000
        }
      )

      if (response.code !== undefined && response.code !== 0) {
        lastError = new Error(response.message || 'Console scoped authorization response is invalid')
        continue
      }
      if (!response.data?.grants || !Array.isArray(response.data.grants)) {
        lastError = new Error('Console scoped authorization response missing grants')
        continue
      }
      return response.data
    } catch (error) {
      console.warn(`[PlatformAuthorization] Console scoped authorization request failed: baseUrl=${baseUrl}, error=${errorMessage(error)}`)
      lastError = error
    }
  }

  throw createError({
    statusCode: 503,
    statusMessage: 'Authorization Unavailable',
    message: lastError
      ? `Console scoped authorization unavailable: ${errorMessage(lastError)}`
      : 'Console scoped authorization unavailable'
  })
}
