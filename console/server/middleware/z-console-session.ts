import { getRequestURL } from 'h3'
import { resolveOptionalConsoleSession } from '~~/server/utils/authSession'
import {
  consoleSessionActorContext,
  shouldResolveConsoleSessionActor
} from '~~/server/utils/consoleSessionActor'

/**
 * Console 自身用 `console_session` 登录，其认证态不是 OIDC access token。Foundation 的
 * `console-auth` 中间件基于 OIDC，对 Console 自身解析不到用户；而 Console app 又无法走
 * session bridge —— Cloudflare Worker 不能 fetch 自己的路由（self-fetch 会超时）。
 *
 * 本中间件以 `z-` 前缀保证在 Foundation `console-auth` 之后运行。审批代理路径和
 * Console mutation API 都必须把本地 session 补全为已验证用户上下文；需要 Runtime
 * 按当前用户做行级过滤的通知读接口、授权生命周期审计读接口也使用同一桥接。前者用于
 * Workflow 当前用户，后两类用于生成与短期 Runtime token 绑定的 actor delegation。
 * 其他只读 Console API 不额外解析 session；无 session 的 service 请求保持原认证上下文。
 */
export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname
  if (!shouldResolveConsoleSessionActor(pathname, event.method)) return

  const existing = event.context.consoleAuth as { authenticated?: boolean } | undefined
  if (existing?.authenticated) return

  const session = await resolveOptionalConsoleSession(event, { allowLegacyFallback: false }).catch((error) => {
    console.warn('[console-session-mw] resolve error:', error instanceof Error ? error.message : String(error))
    return null
  })
  if (!session?.uid) return

  event.context.consoleAuth = consoleSessionActorContext(session, existing)
})
