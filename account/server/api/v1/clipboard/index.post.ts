/**
 * 写入汇智云粘贴板
 * POST /api/v1/clipboard
 *
 * 将内容写入用户的临时粘贴板（覆盖式，每用户仅保留最新一条，30 分钟过期）。
 */

import { verifyApiKey } from '~~/server/utils/api-auth'
import { clipboardSet } from '~~/server/utils/clipboard'

defineRouteMeta({
  openAPI: {
    tags: ['粘贴板'],
    summary: '写入粘贴板',
    description: '将内容写入用户的临时粘贴板。每用户仅保留最新一条，30 分钟后自动过期。需要 API Key 认证。',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['uid', 'content'],
            properties: {
              uid: { type: 'string', description: '用户 UID' },
              content: { type: 'string', description: '粘贴板内容（Markdown 片段）' },
              contentType: { type: 'string', enum: ['markdown', 'text', 'json'], description: '内容类型（默认 markdown）' },
              sourceApp: { type: 'string', description: '来源模块编码，如 codocs、account' }
            }
          }
        }
      }
    }
  }
})

interface ClipboardPostBody {
  uid: string
  content: string
  contentType?: 'markdown' | 'text' | 'json'
  sourceApp?: string
}

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

  const body = await readBody<ClipboardPostBody>(event)
  const { uid, content, contentType, sourceApp } = body

  if (!uid || !content) {
    throw createError({ statusCode: 400, message: '缺少 uid 或 content' })
  }

  // 限制内容大小：最大 512 KB
  if (content.length > 512 * 1024) {
    throw createError({ statusCode: 400, message: '内容超过 512 KB 限制' })
  }

  clipboardSet(uid, {
    content,
    contentType: contentType || 'markdown',
    sourceApp: sourceApp || 'unknown'
  })

  return { code: 0, message: 'ok' }
})
