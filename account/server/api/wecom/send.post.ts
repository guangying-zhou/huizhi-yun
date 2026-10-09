/**
 * 企业微信消息发送 — 内部 API（Cookie 认证）
 * POST /api/wecom/send
 *
 * 供 Account 管理界面使用，需管理员权限
 */
import { sendWecomMessage, validateMessageRequest, isWecomConfigured } from '~~/server/utils/wecom'
import { useDbPool } from '~~/server/utils/db'
import type { WecomMessageRequest } from '~~/server/utils/wecom'

export default defineEventHandler(async (event) => {
  // Cookie 认证
  const uid = getCookie(event, 'auth_user')
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

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

  // 发送消息
  const result = await sendWecomMessage(body)

  // 记录到数据库（异步，不阻塞响应）
  const pool = useDbPool()
  pool.execute(
    `INSERT INTO message_logs (channel, msg_type, title, content, url, touser, toparty, totag, caller, status, msgid, errcode, errmsg)
     VALUES ('wecom', ?, ?, ?, ?, ?, ?, ?, 'account', ?, ?, ?, ?)`,
    [
      body.msgtype || 'text',
      body.title || null,
      body.description || body.content || null,
      body.url || null,
      body.touser || null,
      body.toparty || null,
      body.totag || null,
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
