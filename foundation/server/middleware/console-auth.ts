import { resolveConsoleAuthWithSessionBridge } from '../utils/consoleSessionBridge'
import { getHeader, getRequestURL, setResponseStatus } from 'h3'
import type { H3Event } from 'h3'
import { decodeJwt } from 'jose'

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function configuredBypassPaths(event: H3Event) {
  const config = useRuntimeConfig(event) as unknown as {
    hzy?: {
      consoleOidc?: {
        bypassAuthPaths?: string[]
      }
    }
  }
  return Array.isArray(config.hzy?.consoleOidc?.bypassAuthPaths)
    ? config.hzy.consoleOidc.bypassAuthPaths
    : []
}

function shouldBypassConsoleAuth(pathname: string, paths: string[]) {
  return paths.some((path) => {
    const normalized = String(path || '').trim()
    if (!normalized) return false
    if (normalized.endsWith('*')) {
      return pathname.startsWith(normalized.slice(0, -1))
    }
    return pathname === normalized
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
      pathname.endsWith('/read') || pathname.endsWith('/archive')
    ))
}

// 仅 Console 自身这些端点的 handler 自行处理 service token（透传 / 自验），需要在中间件层 bypass，
// 跳过下方 OIDC 验签与未认证 401 拦截。业务模块的 service API（requireServiceScope）必须走验签，
// 由 resolveConsoleAuthContext 设置 authenticated=true，因此不能放进该白名单。
function acceptsConsoleServiceToken(pathname: string) {
  return pathname === '/api/v1/console/vault/resolve'
    || pathname === '/api/v1/console/integrations'
    || pathname.startsWith('/api/v1/console/integrations/')
    || pathname === '/api/v1/console/notifications/publish'
}

function isAuthApiPath(pathname: string) {
  return pathname.startsWith('/api/auth/') || pathname.includes('/api/auth/')
}

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname
  const isAuthApi = isAuthApiPath(pathname)
  const bypassConsoleAuth = shouldBypassConsoleAuth(pathname, configuredBypassPaths(event))

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
    setResponseStatus(event, 401)
    return {
      code: 401,
      message: '请先登录',
      data: null
    }
  }
})
