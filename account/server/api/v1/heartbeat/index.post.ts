/**
 * 用户心跳上报 API
 * POST /api/v1/heartbeat
 *
 * 各模块前端定时调用，上报用户在线状态。
 * 使用 REPLACE INTO 实现 upsert（按 uid + source_app 联合主键）。
 */

import { verifyApiKey } from '~~/server/utils/api-auth'
import { execute } from '~~/server/utils/db'

defineRouteMeta({
  openAPI: {
    tags: ['用户在线'],
    summary: '上报用户心跳',
    description: '各模块前端定时调用，上报用户当前在线状态和所在页面。需要 API Key 认证。',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['uid', 'sourceApp'],
            properties: {
              uid: { type: 'string', description: '用户 UID' },
              sourceApp: { type: 'string', description: '来源模块编码' },
              page: { type: 'string', description: '当前页面路径' },
              status: { type: 'string', enum: ['active', 'idle'], description: '状态（默认 active）' }
            }
          }
        }
      }
    }
  }
})

interface HeartbeatRequest {
  uid: string
  sourceApp: string
  page?: string
  status?: 'active' | 'idle'
}

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

  const body = await readBody<HeartbeatRequest>(event)
  const { uid, sourceApp, page, status } = body

  if (!uid || !sourceApp) {
    throw createError({ statusCode: 400, message: '缺少 uid 或 sourceApp' })
  }

  await execute(
    'REPLACE INTO user_heartbeats (uid, source_app, page, status, last_seen) VALUES (?, ?, ?, ?, NOW())',
    [uid, sourceApp, page || null, status || 'active']
  )

  return { success: true }
})
