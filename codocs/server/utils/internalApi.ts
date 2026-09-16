/**
 * 模块间 API 认证工具
 * 验证 Console service token
 */
import type { H3Event } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { getRequestUid } from './authIdentity'

export async function verifyInternalApi(event: H3Event, options: { scopes?: string[] } = {}): Promise<void> {
  const auth = await requireConsoleAuthContext(event)
  if (auth.tokenUse !== 'service') {
    throw createError({ statusCode: 401, message: '模块间 API 需要 Console service token' })
  }

  const requiredScopes = options.scopes || ['codocs:documents:read']
  const grantedScopes = auth.scopes || []
  const allowed = requiredScopes.some(scope => grantedScopes.includes(scope))
  if (!allowed) {
    throw createError({ statusCode: 403, message: `缺少服务权限: ${requiredScopes.join(' or ')}` })
  }
}

/**
 * 从请求中获取调用方身份（auth_user cookie）
 * 模块间调用方身份由 Console service token 表示，用户级 uid 由业务请求体显式传入。
 */
export function getCallerUid(event: H3Event): string | null {
  const uid = getRequestUid(event)
  if (uid) return uid
  return null
}
