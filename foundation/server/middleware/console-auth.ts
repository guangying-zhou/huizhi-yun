import { resolveConsoleAuthWithSessionBridge } from '../utils/consoleSessionBridge'
import { getHeader, getRequestURL, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import { decodeJwt } from 'jose'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function defaultBypassPaths(event: H3Event) {
  const config = useRuntimeConfig(event) as unknown as {
    hzy?: {
      appCode?: string
    }
    public?: {
      appCode?: string
      appName?: string
    }
  }
  const appCode = stringValue(config.hzy?.appCode || config.public?.appCode || config.public?.appName).toLowerCase()
  if (appCode !== 'assets') return []

  return [
    '/api/v1/dictionaries',
    '/api/v1/dictionaries/',
    '/assets/api/v1/dictionaries',
    '/assets/api/v1/dictionaries/'
  ]
}

function configuredBypassPaths(event: H3Event) {
  const config = useRuntimeConfig(event) as unknown as {
    hzy?: {
      consoleOidc?: {
        bypassAuthPaths?: string[]
      }
    }
    consoleOidc?: {
      bypassAuthPaths?: string[]
    }
  }
  const defaults = defaultBypassPaths(event)
  if (Array.isArray(config.hzy?.consoleOidc?.bypassAuthPaths)) {
    return [...defaults, ...config.hzy.consoleOidc.bypassAuthPaths]
  }
  if (Array.isArray(config.consoleOidc?.bypassAuthPaths)) {
    return [...defaults, ...config.consoleOidc.bypassAuthPaths]
  }
  return defaults
}

function matchesApiPathWithOptionalAppBase(pathname: string, normalizedPath: string) {
  return pathname === normalizedPath
    || (normalizedPath.startsWith('/api/') && pathname.endsWith(normalizedPath))
}

function shouldBypassConsoleAuth(pathname: string, paths: string[]) {
  return paths.some((path) => {
    const normalized = String(path || '').trim()
    if (!normalized) return false
    if (normalized.endsWith('*')) {
      const prefix = normalized.slice(0, -1)
      return pathname.startsWith(prefix)
        || (prefix.startsWith('/api/') && pathname.includes(prefix))
    }
    return matchesApiPathWithOptionalAppBase(pathname, normalized)
  })
}

function getBearerServiceToken(event: H3Event) {
  const authorization = stringValue(getHeader(event, 'authorization'))
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match?.[1]) return ''

  try {
    const claims = decodeJwt(match[1])
    return claims.token_use === 'service' ? match[1] : ''
  } catch {
    return ''
  }
}

function getBearerApplicationAccessToken(event: H3Event) {
  const authorization = stringValue(getHeader(event, 'authorization'))
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match?.[1]) return ''

  try {
    const claims = decodeJwt(match[1])
    return claims.token_use === 'access' ? match[1] : ''
  } catch {
    return ''
  }
}

function acceptsConsoleApplicationAccessToken(pathname: string) {
  return pathname === '/api/v1/console/user/applications'
    || pathname === '/api/v1/console/user/permissions'
    || pathname === '/api/v1/console/user/scoped-authorization'
    || pathname === '/api/v1/console/notifications'
    || pathname === '/api/v1/console/notifications/summary'
    || pathname === '/api/v1/console/notifications/read-all'
    || (pathname.startsWith('/api/v1/console/notifications/') && (
      pathname.endsWith('/detail') || pathname.endsWith('/read') || pathname.endsWith('/archive')
    ))
}

// 仅 Console 自身这些端点的 handler 自行处理 service token（透传 / 自验），需要在中间件层 bypass，
// 跳过下方 OIDC 验签与未认证 401 拦截。业务模块的 service API（requireServiceScope）必须走验签，
// 由 resolveConsoleAuthContext 设置 authenticated=true，因此不能放进该白名单。
function acceptsConsoleServiceToken(pathname: string) {
  return pathname === '/api/v1/console/vault/resolve'
    || pathname === '/api/v1/console/service/business-domains'
    || pathname.startsWith('/api/v1/console/service/work-calendar/')
    || pathname.startsWith('/api/v1/console/service/directory/')
    || pathname.startsWith('/api/v1/console/service/directory-connector/')
    || pathname === '/api/v1/console/service/connector-runtime/heartbeat'
    || pathname === '/api/v1/console/integrations'
    || pathname.startsWith('/api/v1/console/integrations/')
    || pathname === '/api/v1/console/settings/values'
    || pathname === '/api/v1/console/notifications/publish'
    || pathname === '/api/v1/console/notifications/actionable-lifecycle'
    || pathname === '/api/v1/console/notifications/integration-operation-dead-letter'
}

function isAuthApiPath(pathname: string) {
  return pathname.startsWith('/api/auth/') || pathname.includes('/api/auth/')
}

function isServiceTokenIntrospectionPath(pathname: string) {
  return pathname === '/oauth/introspect'
    // userinfo's handler verifies the user token and live session itself.
    // Generic auth would first validate an app token against Console's audience
    // and perform redundant backchannel work before the authoritative handler.
    || pathname === '/oauth/userinfo'
}

export default defineEventHandler(async (event) => {
  const requestPath = getRequestURL(event).pathname
  // Nitro Dev retains the configured app base in getRequestURL. Match the
  // same handler-owned auth boundaries as the root-mounted Worker; never
  // infer the prefix from an untrusted forwarded header or a suffix match.
  const runtimeConfig = useRuntimeConfig(event) as { app?: { baseURL?: string, buildAssetsDir?: string } }
  const base = String(runtimeConfig.app?.baseURL || '/').replace(/\/$/, '')
  const pathname = base && base.startsWith('/') && !base.startsWith('//') && requestPath.startsWith(`${base}/`)
    ? requestPath.slice(base.length)
    : requestPath
  if (pathname === '/_hzy0_worker_health'
    || requestPath === '/enterprise/_hzy0_worker_health'
    || requestPath === '/console/_hzy0_worker_health') return
  // Public build artifacts and generated icons do not consume user identity.
  // They were already readable without cookies; a cookie must not turn each
  // Vite module into a live session/policy request. Business APIs stay below.
  const assets = runtimeConfig.app?.buildAssetsDir || '/_nuxt/'
  const publicAsset = assets.startsWith('/') && assets.endsWith('/') && assets !== '/'
    && pathname.startsWith(assets)
  const publicIcon = /^\/api\/_nuxt_icon\/[a-z0-9-]+\.json$/.test(pathname)
  if (['GET', 'HEAD'].includes(event.method) && (publicAsset || publicIcon)) return
  const isAuthApi = isAuthApiPath(pathname)
  // Introspection is itself the service-token verification boundary. Running
  // the generic auth middleware first would require introspection in order to
  // enter introspection, creating an internal recursion (or an edge 522 when
  // dispatched through the Console Worker's public custom domain).
  const bypassConsoleAuth = isServiceTokenIntrospectionPath(pathname)
    // The token handler authenticates each grant itself. Keep this exact:
    // /oauth/tokenized and other OAuth routes retain generic authentication.
    || pathname === '/oauth/token'
    // Dedicated handler authenticates the signed Gateway scheduler request.
    || pathname === '/api/internal/policy-bundle/sync'
    || shouldBypassConsoleAuth(pathname, configuredBypassPaths(event))

  if (bypassConsoleAuth) {
    event.context.consoleAuth = { authenticated: false, reason: 'bypass' }
    return
  }

  const bearerServiceToken = getBearerServiceToken(event)
  const bearerApplicationAccessToken = getBearerApplicationAccessToken(event)
  if (bearerApplicationAccessToken && acceptsConsoleApplicationAccessToken(pathname)) {
    event.context.consoleAuth = {
      authenticated: false,
      reason: 'bypass',
      token: bearerApplicationAccessToken,
      tokenUse: 'access',
      subjectType: 'user'
    }
    return
  }

  if (bearerServiceToken && acceptsConsoleServiceToken(pathname)) {
    event.context.consoleAuth = {
      authenticated: false,
      reason: 'bypass',
      token: bearerServiceToken,
      tokenUse: 'service',
      subjectType: 'service'
    }
    return
  }

  // 不覆盖已认证的 consoleAuth：Console 自身用 session 登录，其认证态可能已由本地中间件
  // （console/server/middleware/z-console-session）补全；这里基于 OIDC 的解析不应把它打回
  // 未认证。对未预设 consoleAuth 的业务应用无影响（初始为空，照常解析）。
  if (!(event.context.consoleAuth as { authenticated?: boolean } | undefined)?.authenticated) {
    event.context.consoleAuth = await resolveConsoleAuthWithSessionBridge(event)
  }
  const consoleAuth = event.context.consoleAuth as Awaited<ReturnType<typeof resolveConsoleAuthWithSessionBridge>>

  if (
    pathname.startsWith('/api/')
    && !isAuthApi
    && !consoleAuth.authenticated
    && consoleAuth.token
  ) {
    console.warn('[console-auth] api auth rejected:', {
      pathname,
      reason: consoleAuth.reason,
      tokenUse: consoleAuth.tokenUse,
      subjectType: consoleAuth.subjectType,
      hasBearerServiceToken: Boolean(bearerServiceToken),
      hasBearerApplicationAccessToken: Boolean(bearerApplicationAccessToken),
      hasAuthorization: Boolean(stringValue(getHeader(event, 'authorization')))
    })
    const introspectionUnavailable = consoleAuth.reason === 'service_token_introspection_unavailable'
    setResponseStatus(event, introspectionUnavailable ? 503 : 401)
    return {
      code: introspectionUnavailable ? 503 : 401,
      message: introspectionUnavailable ? '服务令牌状态暂时无法校验，请稍后重试' : '请先登录',
      data: null
    }
  }
})
