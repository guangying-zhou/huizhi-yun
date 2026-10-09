/**
 * 将邮箱回写到钉钉用户
 * POST /api/dingtalk/writeback-emails
 *
 * 调用钉钉 topapi/v2/user/update 更新用户邮箱
 */

interface WritebackRequest {
  users: Array<{ userid: string, email: string }>
}

export default defineEventHandler(async (event) => {
  const uid = getCookie(event, 'auth_user')
  if (!uid) throw createError({ statusCode: 401, message: '请先登录' })

  const body = await readBody<WritebackRequest>(event)

  if (!body?.users || !Array.isArray(body.users) || body.users.length === 0) {
    throw createError({ statusCode: 400, message: '请提供 users 数组' })
  }

  // 动态导入以获取 token
  const { isDingtalkConfigured } = await import('~~/server/utils/dingtalk')
  if (!isDingtalkConfigured()) {
    throw createError({ statusCode: 503, message: '钉钉服务未配置' })
  }

  // 需要直接获取 token 来调用更新接口
  const config = useRuntimeConfig()
  const { appId, appSecret } = { appId: config.dingtalk.appId, appSecret: config.dingtalk.appSecret }

  // 获取 token
  const tokenResult = await $fetch<{ accessToken: string }>('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    method: 'POST',
    body: { appKey: appId, appSecret }
  })
  const accessToken = tokenResult.accessToken

  let success = 0
  let failed = 0
  const errors: Array<{ userid: string, error: string }> = []

  for (const user of body.users) {
    if (!user.userid || !user.email) continue

    try {
      const result = await $fetch<{ errcode: number, errmsg: string }>(
        `https://oapi.dingtalk.com/topapi/v2/user/update?access_token=${accessToken}`,
        {
          method: 'POST',
          body: {
            userid: user.userid,
            email: user.email
          }
        }
      )

      if (result.errcode === 0) {
        success++
      } else {
        failed++
        errors.push({ userid: user.userid, error: `${result.errcode}: ${result.errmsg}` })
      }
    } catch (err: unknown) {
      const error = err as { message?: string }
      failed++
      errors.push({ userid: user.userid, error: error.message || '未知错误' })
    }
  }

  return {
    code: 0,
    data: {
      total: body.users.length,
      success,
      failed,
      errors: errors.slice(0, 10) // 最多返回 10 个错误详情
    }
  }
})
