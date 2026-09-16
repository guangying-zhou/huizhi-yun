import { defineEventHandler, getRequestURL, sendRedirect } from 'h3'
import { appCode, matchRouteRule } from '~~/app/config/permissions'
import { resolveOptionalConsoleSession } from '~~/server/utils/authSession'
import {
  hasPermissionInSnapshot,
  loadPolicyAuthorizationSnapshot
} from '~~/server/utils/policyAuthorization'

function isPageMethod(method: string) {
  return method === 'GET' || method === 'HEAD'
}

function isBypassPath(pathname: string) {
  return pathname === '/login'
    || pathname === '/activation'
    // 员工凭一次性激活链接设置密码时还没有可用账号，无法通过登录校验。
    || pathname === '/set-password'
    || pathname.startsWith('/api/')
    || pathname.startsWith('/oauth/')
    || pathname.startsWith('/.well-known/')
    || pathname.startsWith('/_nuxt/')
    || pathname === '/favicon.ico'
    || pathname === '/favicon.png'
    || pathname === '/logo.svg'
    || pathname === '/logo.png'
    || pathname === '/robots.txt'
}

function normalizePagePath(pathname: string) {
  if (!pathname || pathname === '/') return '/'
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

function redirectWithReturn(pathname: string, search: string) {
  const query = new URLSearchParams()
  query.set('redirect', `${pathname}${search}`)
  return `/login?${query.toString()}`
}

export default defineEventHandler(async (event) => {
  const method = String(event.method || 'GET').toUpperCase()
  if (!isPageMethod(method)) return

  const url = getRequestURL(event)
  const pathname = normalizePagePath(url.pathname)
  if (isBypassPath(pathname)) return

  const rule = matchRouteRule(pathname)
  if (!rule) return

  const session = await resolveOptionalConsoleSession(event, {
    allowLegacyFallback: false,
    touch: false
  })

  if (!session) {
    return sendRedirect(event, redirectWithReturn(url.pathname, url.search), 302)
  }

  const snapshot = await loadPolicyAuthorizationSnapshot(session.uid, appCode, event)
  if (!hasPermissionInSnapshot(snapshot, rule.resource, rule.action)) {
    return sendRedirect(event, '/profile', 302)
  }
})
