import { getRequestURL } from 'h3'
import { resolveOptionalConsoleSession } from '~~/server/utils/authSession'

/**
 * Console 自身用 `console_session` 登录，其认证态不是 OIDC access token。Foundation 的
 * `console-auth` 中间件基于 OIDC，对 Console 自身解析不到用户；而 Console app 又无法走
 * session bridge —— Cloudflare Worker 不能 fetch 自己的路由（self-fetch 会超时）。
 *
 * 本中间件以 `z-` 前缀保证在 Foundation `console-auth` 之后运行，仅对审批代理路径
 * （workflow-proxy）用本地 session 直接补全 `event.context.consoleAuth`，使
 * `workflow-proxy` 的 `currentUserUid` 能拿到当前用户，避免 401。对其他路径与业务应用
 * 无影响。
 */
export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname
  if (!pathname.startsWith('/api/workflow-proxy/')) return

  const existing = event.context.consoleAuth as { authenticated?: boolean } | undefined
  if (existing?.authenticated) return

  const session = await resolveOptionalConsoleSession(event, { allowLegacyFallback: false }).catch((error) => {
    console.warn('[console-session-mw] resolve error:', error instanceof Error ? error.message : String(error))
    return null
  })
  console.log('[console-session-mw] resolved:', { hasSession: Boolean(session), uid: session?.uid || null })
  if (!session?.uid) return

  event.context.consoleAuth = {
    ...(existing || {}),
    authenticated: true,
    subjectType: 'user',
    uid: session.uid,
    subjectCode: session.uid,
    tokenUse: 'console_session'
  }
})
