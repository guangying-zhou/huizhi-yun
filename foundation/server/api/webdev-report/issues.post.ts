import { createError } from 'h3'

// 业务应用共享路由：接收 Foundation 报告组件提交，派生提交者身份后经 service token 转发到 WebDev intake。
export default defineEventHandler(async (event): Promise<unknown> => {
  const auth = await resolveConsoleAuthWithSessionBridge(event)
  if (!auth.authenticated || !auth.uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const body = await readBody(event)
  const input = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {}

  // reporter 身份由业务应用服务端会话派生，不接受客户端传值
  const reporterName = auth.subjectCode || auth.uid
  const result = await reportWebDevIssue(event, {
    ...input,
    reporterUid: auth.uid,
    reporterName
  })

  // 反馈通知：向配置的企业微信号推送提醒；失败不影响提交结果
  try {
    await notifyFeedbackRecipients(event, { input, reporterName, result })
  } catch (error) {
    console.warn('[webdev-report] feedback WeCom notification failed:', error)
  }

  return result
})
