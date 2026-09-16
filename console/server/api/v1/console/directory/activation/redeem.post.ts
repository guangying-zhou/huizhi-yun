import { redeemConsoleDirectoryActivationCredential } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { readBody } from 'h3'

// 与 inspect 同理，本路由不要求登录会话。密码策略校验、令牌消费和改密排队
// 都在运行时的同一事务内完成，并发兑换只有一个能成功。
export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: unknown, newPassword?: unknown }>(event)
  const token = String(body?.token || '').trim()
  const newPassword = String(body?.newPassword || '')
  if (!token) throw createError({ statusCode: 400, message: '缺少激活令牌' })
  if (newPassword.length < 10) throw createError({ statusCode: 400, message: '密码至少需要 10 个字符' })

  const response = await redeemConsoleDirectoryActivationCredential(event, token, newPassword)
  // 只回传排队结果，不回传令牌、DN 或任何目录内部字段。
  return { code: 0, data: { uid: (response.data as Record<string, unknown>)?.uid } }
})
