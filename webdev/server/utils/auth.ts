import { createError, getCookie, getHeader, type H3Event } from 'h3'

type ConsoleAuthContext = {
  authenticated?: boolean
  reason?: string
  token?: string
  tokenUse?: string
  subjectType?: string
  uid?: string
  subjectCode?: string
}

type ConsoleApplicationsResponse = {
  code?: number
  data?: unknown
  message?: string
}

type ConsolePermissionsResponse = {
  code?: number
  data?: unknown
  message?: string
}

type ApplicationRecord = {
  appCode?: unknown
  status?: unknown
}

type WebDevPermissionSnapshot = {
  uid: string
  roles: string[]
  resources: Record<string, string[]>
}

type CloudflareEnv = Record<string, unknown>

type CloudflareRuntimeEvent = H3Event & {
  context?: H3Event['context'] & {
    cloudflare?: {
      env?: CloudflareEnv
    }
    _platform?: {
      cloudflare?: {
        env?: CloudflareEnv
      }
    }
  }
  req?: {
    runtime?: {
      cloudflare?: {
        env?: CloudflareEnv
      }
    }
  }
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function cloudflareEnv(event: H3Event): CloudflareEnv {
  const runtimeEvent = event as CloudflareRuntimeEvent
  return runtimeEvent.context?.cloudflare?.env
    || runtimeEvent.context?._platform?.cloudflare?.env
    || runtimeEvent.req?.runtime?.cloudflare?.env
    || {}
}

function runtimeEnvValue(event: H3Event, names: string[]) {
  const env = cloudflareEnv(event)
  for (const name of names) {
    const value = stringValue(env[name] || process.env[name])
    if (value) return value
  }
  return ''
}

function configValue(event: H3Event, keys: string[]) {
  const config = useRuntimeConfig(event) as unknown as Record<string, unknown>

  for (const key of keys) {
    let current: unknown = config
    for (const part of key.split('.')) {
      if (!current || typeof current !== 'object') {
        current = undefined
        break
      }
      current = (current as Record<string, unknown>)[part]
    }

    const normalized = stringValue(current)
    if (normalized) return normalized
  }
  return ''
}

function splitList(value: unknown) {
  return stringValue(value)
    .split(/[,\s]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function configuredAppCode(event: H3Event) {
  return configValue(event, ['public.appCode', 'public.appName']) || 'webdev'
}

function configuredConsoleUrl(event: H3Event) {
  return stringValue(configValue(event, [
    'public.consoleUrl',
    'hzy.consoleRuntime.consoleApiUrl',
    'hzy.directory.consoleApiUrl'
  ]) || runtimeEnvValue(event, ['HZY_CONSOLE_URL', 'HZY_CONSOLE_API_URL']))
    .replace(/[?#].*$/, '')
    .replace(/\/admin\/?$/i, '')
    .replace(/\/+$/, '')
}

function allowedUidSet(event: H3Event) {
  return new Set(splitList(configValue(event, ['webdev.allowedUids']) || runtimeEnvValue(event, ['HZY_WEBDEV_ALLOWED_UIDS'])))
}

function shouldRequireAppGrant(event: H3Event) {
  const configured = stringValue(configValue(event, ['webdev.requireAppGrant']) || runtimeEnvValue(event, ['HZY_WEBDEV_REQUIRE_APP_GRANT']))
  if (configured) {
    return configured.toLowerCase() !== 'false'
  }

  return process.env.NODE_ENV === 'production'
}

function isUidExplicitlyAllowed(event: H3Event, uid: string) {
  const allowed = allowedUidSet(event)
  return allowed.has('*') || allowed.has(uid)
}

async function resolveWebDevConsoleAuth(event: H3Event): Promise<ConsoleAuthContext> {
  const existing = event.context.consoleAuth as ConsoleAuthContext | undefined
  if (existing?.authenticated || existing?.reason) {
    return existing
  }

  const resolved = await resolveConsoleAuthWithSessionBridge(event)
  event.context.consoleAuth = resolved
  return resolved as ConsoleAuthContext
}

function applicationItems(value: unknown): ApplicationRecord[] {
  const rawItems = Array.isArray(value)
    ? value
    : Array.isArray((value as { items?: unknown[] } | undefined)?.items)
      ? (value as { items: unknown[] }).items
      : []

  return rawItems.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as ApplicationRecord[]
}

function isActiveApplication(item: ApplicationRecord) {
  const status = stringValue(item.status)
  return !status || status === 'active'
}

function authForwardHeaders(event: H3Event, auth: ConsoleAuthContext) {
  const headers: Record<string, string> = {}
  const token = stringValue(auth.token)
  if (token && auth.tokenUse !== 'legacy_session' && auth.subjectType !== 'service') {
    headers.authorization = `Bearer ${token}`
    return headers
  }

  const cookie = stringValue(getHeader(event, 'cookie'))
  if (cookie) {
    headers.cookie = cookie
  }
  return headers
}

async function hasConsoleApplicationGrant(event: H3Event, auth: ConsoleAuthContext) {
  const consoleUrl = configuredConsoleUrl(event)
  if (!consoleUrl) return false

  const headers = authForwardHeaders(event, auth)
  if (!headers.authorization && !headers.cookie) return false

  const url = headers.authorization
    ? `${consoleUrl}/api/v1/console/user/applications`
    : `${consoleUrl}/api/user/applications`

  try {
    const response = await $fetch<ConsoleApplicationsResponse>(url, {
      headers,
      timeout: 3000
    })
    if (response.code !== undefined && response.code !== 0) return false

    const appCode = configuredAppCode(event)
    return applicationItems(response.data).some(item => stringValue(item.appCode) === appCode && isActiveApplication(item))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[webdev] Console application grant check failed: ${message}`)
    return false
  }
}

function allowedReportApps(event: H3Event) {
  const configured = splitList(configValue(event, ['webdev.reportAllowedApps']) || runtimeEnvValue(event, ['HZY_WEBDEV_REPORT_ALLOWED_APPS']))
  if (configured.length) return new Set(configured)
  return new Set(['codocs', 'finance', 'workflow', 'aims', 'altoc', 'assets', 'align', 'insights', 'console'])
}

function fullWebDevPermissions(uid: string): WebDevPermissionSnapshot {
  return {
    uid,
    roles: ['webdev:admin'],
    resources: {
      webdev_workspace: ['view', 'execute', 'deploy', 'admin']
    }
  }
}

function permissionsFromResponse(uid: string, value: unknown): WebDevPermissionSnapshot {
  const data = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { roles?: unknown, resources?: unknown }
    : {}
  const resources = data.resources && typeof data.resources === 'object' && !Array.isArray(data.resources)
    ? Object.fromEntries(Object.entries(data.resources as Record<string, unknown>).map(([resource, actions]) => [
        resource,
        Array.isArray(actions) ? actions.map(action => stringValue(action)).filter(Boolean) : []
      ]))
    : {}
  const roles = Array.isArray(data.roles) ? data.roles.map(role => stringValue(role)).filter(Boolean) : []

  return { uid, roles, resources }
}

function cachePermissions(event: H3Event, snapshot: WebDevPermissionSnapshot) {
  ;(event.context as { __webdevPermissions?: WebDevPermissionSnapshot }).__webdevPermissions = snapshot
  return snapshot
}

export function hasWebDevPermission(
  snapshot: Pick<WebDevPermissionSnapshot, 'resources'>,
  resource: string,
  action: string
) {
  const actions = snapshot.resources[resource] || []
  if (action === 'view') {
    return actions.includes('view') || actions.includes('execute') || actions.includes('admin')
  }
  if (action === 'execute') {
    return actions.includes('execute') || actions.includes('admin')
  }
  if (action === 'admin') {
    return actions.includes('admin')
  }
  return actions.includes(action)
}

export async function loadWebDevPermissionSnapshot(event: H3Event): Promise<WebDevPermissionSnapshot> {
  const cached = (event.context as { __webdevPermissions?: WebDevPermissionSnapshot }).__webdevPermissions
  if (cached) return cached

  const auth = await requireWebDevUser(event)
  const uid = stringValue(auth.uid || getCookie(event, 'auth_user'))
  if (isUidExplicitlyAllowed(event, uid) || !shouldRequireAppGrant(event)) {
    return cachePermissions(event, fullWebDevPermissions(uid))
  }

  const consoleUrl = configuredConsoleUrl(event)
  const headers = authForwardHeaders(event, auth)
  if (!consoleUrl || (!headers.authorization && !headers.cookie)) {
    return cachePermissions(event, { uid, roles: [], resources: {} })
  }

  const path = headers.authorization
    ? '/api/v1/console/user/permissions'
    : '/api/auth/permissions'
  const url = new URL(path, `${consoleUrl}/`)
  url.searchParams.set('appCode', configuredAppCode(event))

  try {
    const response = await $fetch<ConsolePermissionsResponse>(url.toString(), {
      headers,
      timeout: 3000
    })
    if (response.code !== undefined && response.code !== 0) {
      return cachePermissions(event, { uid, roles: [], resources: {} })
    }
    return cachePermissions(event, permissionsFromResponse(uid, response.data))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[webdev] Console permission check failed: ${message}`)
    return cachePermissions(event, { uid, roles: [], resources: {} })
  }
}

export async function requireWebDevPermission(
  event: H3Event,
  resource: string,
  action: string,
  message = '权限不足'
) {
  const snapshot = await loadWebDevPermissionSnapshot(event)
  if (!hasWebDevPermission(snapshot, resource, action)) {
    throw createError({ statusCode: 403, message })
  }
  return snapshot
}

// 上报入口（intake / mine）专用：要求 Console service token，校验 scope 与来源应用。
export async function requireWebDevService(event: H3Event, requiredScopes: string[]) {
  const ctx = await resolveConsoleAuthContext(event)
  event.context.consoleAuth = ctx as unknown as ConsoleAuthContext

  if (!ctx.authenticated || ctx.subjectType !== 'service' || ctx.tokenUse !== 'service') {
    console.warn('[webdev] service auth rejected before scope check:', {
      authenticated: Boolean(ctx.authenticated),
      reason: ctx.reason,
      tokenUse: ctx.tokenUse,
      subjectType: ctx.subjectType,
      appCode: ctx.appCode,
      scopes: ctx.scopes,
      tenant: ctx.tenant,
      deployment: ctx.deployment,
      requiredScopes,
      hasAuthorization: Boolean(stringValue(getHeader(event, 'authorization')))
    })
    throw createError({ statusCode: 401, message: '需要 Console service token' })
  }

  const scopes = ctx.scopes || []
  if (requiredScopes.length && !requiredScopes.some(scope => scopes.includes(scope))) {
    console.warn('[webdev] service auth rejected by scope:', {
      appCode: ctx.appCode,
      scopes,
      requiredScopes,
      tenant: ctx.tenant,
      deployment: ctx.deployment
    })
    throw createError({ statusCode: 403, message: 'service token 缺少所需 scope' })
  }

  const appCode = stringValue(ctx.appCode)
  if (!appCode || !allowedReportApps(event).has(appCode)) {
    console.warn('[webdev] service auth rejected by source app:', {
      appCode: ctx.appCode,
      allowedApps: [...allowedReportApps(event)],
      scopes,
      tenant: ctx.tenant,
      deployment: ctx.deployment
    })
    throw createError({ statusCode: 403, message: '来源应用未被允许上报 Issue' })
  }
  return ctx
}

export async function requireWebDevUser(event: H3Event): Promise<ConsoleAuthContext> {
  const auth = await resolveWebDevConsoleAuth(event)
  const uid = stringValue(auth.uid || getCookie(event, 'auth_user'))

  if (!auth.authenticated || !uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  if (isUidExplicitlyAllowed(event, uid)) {
    return auth
  }

  if (!shouldRequireAppGrant(event)) {
    return auth
  }

  if (await hasConsoleApplicationGrant(event, auth)) {
    return auth
  }

  throw createError({
    statusCode: 403,
    message: '当前用户未被授权访问 WebDev'
  })
}
