import type { H3Event } from 'h3'
import { getRequestUid, requireRequestUid } from '~~/server/utils/authIdentity'

/**
 * 从请求中获取当前用户 uid
 */
export function getCurrentUser(event: H3Event): string | null {
  return getRequestUid(event) || null
}

/**
 * 要求登录，未登录则抛出 401
 */
export function requireAuth(event: H3Event): string {
  return requireRequestUid(event, '未登录')
}
