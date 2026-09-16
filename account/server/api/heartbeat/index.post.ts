/**
 * 用户心跳上报（公开端点，通过 Cookie 认证）
 * POST /api/heartbeat
 *
 * 各模块前端直接调用 account 的此端点上报心跳。
 * 通过 CAS SSO 共享的 auth_user cookie 识别用户。
 */

import { execute } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const uid = getCookie(event, 'auth_user')
  if (!uid) {
    throw createError({ statusCode: 401, message: '未登录' })
  }

  const body = await readBody(event)
  const { sourceApp, page, status } = body || {}

  if (!sourceApp) {
    throw createError({ statusCode: 400, message: '缺少 sourceApp' })
  }

  await execute(
    'REPLACE INTO user_heartbeats (uid, source_app, page, status, last_seen) VALUES (?, ?, ?, ?, NOW())',
    [uid, sourceApp, page || null, status || 'active']
  )

  return { success: true }
})
