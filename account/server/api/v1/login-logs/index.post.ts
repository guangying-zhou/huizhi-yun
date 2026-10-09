import { verifyApiKey } from '~~/server/utils/api-auth'
import { logLogin } from '~~/server/utils/log'

defineRouteMeta({
  openAPI: {
    tags: ['审计日志'],
    summary: '上报登录日志',
    description: '供其他模块在完成认证后将登录事件统一上报到 Account。需要 API Key 认证。',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['loginType', 'loginResult'],
            properties: {
              uid: { type: 'string', description: '登录用户 UID' },
              targetApp: { type: 'string', description: '登录目标模块编码（默认 external）' },
              loginType: { type: 'string', enum: ['password', 'sso', 'oauth'], description: '登录方式' },
              loginResult: { type: 'integer', enum: [0, 1], description: '0 失败 1 成功' },
              failureReason: { type: 'string' },
              sessionId: { type: 'string' },
              ipAddress: { type: 'string' },
              device: { type: 'string' },
              browser: { type: 'string' },
              os: { type: 'string' }
            }
          }
        }
      }
    }
  }
})

interface LoginLogRequest {
  uid?: string
  targetApp?: string
  loginType: 'password' | 'sso' | 'oauth'
  loginResult: 0 | 1
  failureReason?: string
  sessionId?: string
  ipAddress?: string
  device?: string
  browser?: string
  os?: string
}

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

  const body = await readBody<LoginLogRequest>(event)

  if (!body.loginType) {
    throw createError({
      statusCode: 400,
      message: 'loginType 不能为空'
    })
  }

  if (body.loginResult !== 0 && body.loginResult !== 1) {
    throw createError({
      statusCode: 400,
      message: 'loginResult 必须为 0 或 1'
    })
  }

  await logLogin({
    uid: body.uid || null,
    targetApp: body.targetApp || 'external',
    loginType: body.loginType,
    loginResult: body.loginResult,
    failureReason: body.failureReason || null,
    sessionId: body.sessionId || null,
    ipAddress: body.ipAddress || event.node.req.socket.remoteAddress || null,
    device: body.device || null,
    browser: body.browser || null,
    os: body.os || null
  })

  return {
    code: 0,
    message: 'success',
    data: null
  }
})
