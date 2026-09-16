/**
 * 企业微信消息发送 — 外部 API（API Key 认证）
 * POST /api/v1/wecom/send
 *
 * 供其他应用（codocs 等）调用，通过 API Key 认证
 */
import { sendWecomMessage, validateMessageRequest, isWecomConfigured } from '~~/server/utils/wecom'
import { verifyApiKey } from '~~/server/utils/api-auth'
import { useDbPool, queryRows } from '~~/server/utils/db'
import type { WecomMessageRequest } from '~~/server/utils/wecom'
import type { RowDataPacket } from 'mysql2/promise'

interface WecomIdRow extends RowDataPacket {
  uid: string
  wecom_id: string | null
}

defineRouteMeta({
  openAPI: {
    tags: ['企业微信消息'],
    summary: '发送企业微信消息',
    description: '通过企业微信 API 向指定用户/部门/标签发送消息，支持多种消息类型。需要 API Key 认证。',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['msgtype'],
            properties: {
              touser: { type: 'string', description: '接收用户 ID，多个用 | 分隔，@all 表示全员' },
              toparty: { type: 'string', description: '接收部门 ID，多个用 | 分隔' },
              totag: { type: 'string', description: '接收标签 ID，多个用 | 分隔' },
              msgtype: { type: 'string', enum: ['text', 'markdown', 'textcard', 'news', 'image', 'file', 'voice', 'video'], description: '消息类型' },
              content: { type: 'string', description: '消息内容（text/markdown 必填）' },
              title: { type: 'string', description: '标题（textcard/news 必填）' },
              description: { type: 'string' },
              url: { type: 'string' },
              btntxt: { type: 'string', description: '按钮文字（textcard）' },
              media_id: { type: 'string', description: '媒体ID（image/file/voice/video 必填）' },
              safe: { type: 'integer', enum: [0, 1], description: '是否保密消息' }
            }
          }
        }
      }
    }
  }
})

export default defineEventHandler(async (event) => {
  // API Key 认证
  const apiKeyRecord = await verifyApiKey(event)

  // 检查企业微信配置
  if (!isWecomConfigured()) {
    throw createError({
      statusCode: 503,
      message: '企业微信服务未配置'
    })
  }

  const body = await readBody<WecomMessageRequest>(event)

  if (!body) {
    throw createError({
      statusCode: 400,
      message: '请求体不能为空，请发送 JSON 格式的消息数据'
    })
  }

  // 参数校验
  const validationError = validateMessageRequest(body)
  if (validationError) {
    throw createError({
      statusCode: 400,
      message: validationError
    })
  }

  // 将 touser 中的 uid 自动转换为企业微信 wecom_id
  if (body.touser && body.touser !== '@all') {
    const uids = body.touser.split('|').map(s => s.trim()).filter(Boolean)
    if (uids.length > 0) {
      const placeholders = uids.map(() => '?').join(',')
      const rows = await queryRows<WecomIdRow[]>(
        `SELECT uid, wecom_id FROM system_users WHERE uid IN (${placeholders}) AND status = 1`,
        uids
      )
      const uidToWecomId = new Map<string, string>()
      for (const row of rows) {
        if (row.wecom_id) {
          uidToWecomId.set(row.uid, row.wecom_id)
        }
      }
      // 逐个替换：如果 uid 有对应 wecom_id 则替换，否则保留原值（可能本身就是 wecom_id）
      const resolved = uids.map(uid => uidToWecomId.get(uid) || uid)
      console.log(`[WecomSend] uid→wecom_id: ${uids.join('|')} → ${resolved.join('|')}`)
      body.touser = resolved.join('|')
    }
  }

  // 发送消息
  const result = await sendWecomMessage(body)

  // 记录到数据库（异步，不阻塞响应）
  const pool = useDbPool()
  pool.execute(
    `INSERT INTO message_logs (channel, msg_type, title, content, url, touser, toparty, totag, caller, status, msgid, errcode, errmsg)
     VALUES ('wecom', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.msgtype || 'text',
      body.title || null,
      body.description || body.content || null,
      body.url || null,
      body.touser || null,
      body.toparty || null,
      body.totag || null,
      apiKeyRecord.company_code || apiKeyRecord.key_name || null,
      result.success ? 1 : 0,
      result.msgid || null,
      result.errcode || null,
      result.errmsg || result.error || null
    ]
  ).catch(err => console.error('[MessageLog] Failed to save:', err))

  if (result.success) {
    return {
      code: 0,
      data: { msgid: result.msgid }
    }
  }

  return {
    code: result.errcode || -1,
    message: result.error || '发送失败',
    data: {
      errcode: result.errcode,
      errmsg: result.errmsg
    }
  }
})
