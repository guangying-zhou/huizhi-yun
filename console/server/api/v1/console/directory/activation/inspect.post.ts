import { inspectConsoleDirectoryActivationCredential } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { readBody } from 'h3'

// 员工此时还没有可用账号，无法提供任何用户身份，因此本路由不要求登录会话。
// 激活令牌本身是唯一的授权材料：256 位随机、只以 SHA-256 入库、一次性消费。
// 令牌无效、已兑换、已过期或已作废时，运行时统一返回同一个 404 错误码，
// 不向调用者透露某个令牌是否真实存在。
export default defineEventHandler(async (event) => {
  const body = await readBody<{ token?: unknown }>(event)
  const token = String(body?.token || '').trim()
  if (!token) throw createError({ statusCode: 400, message: '缺少激活令牌' })

  const response = await inspectConsoleDirectoryActivationCredential(event, token)
  return { code: 0, data: response.data }
})
