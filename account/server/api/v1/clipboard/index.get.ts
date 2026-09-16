/**
 * 读取汇智云粘贴板
 * GET /api/v1/clipboard?uid=xxx
 *
 * 获取用户粘贴板中的最新内容。过期或无内容时返回 null。
 */

import { verifyApiKey } from '~~/server/utils/api-auth'
import { clipboardGet } from '~~/server/utils/clipboard'

defineRouteMeta({
  openAPI: {
    tags: ['粘贴板'],
    summary: '读取粘贴板',
    description: '获取用户粘贴板中的最新内容。过期（30 分钟）或无内容时 data 为 null。需要 API Key 认证。',
    parameters: [
      {
        name: 'uid',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: '用户 UID'
      }
    ]
  }
})

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

  const { uid } = getQuery(event) as { uid?: string }

  if (!uid) {
    throw createError({ statusCode: 400, message: '缺少 uid 参数' })
  }

  const entry = clipboardGet(uid)

  return {
    code: 0,
    message: 'ok',
    data: entry
      ? {
          content: entry.content,
          contentType: entry.contentType,
          sourceApp: entry.sourceApp,
          createdAt: new Date(entry.createdAt).toISOString()
        }
      : null
  }
})
