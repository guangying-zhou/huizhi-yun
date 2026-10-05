/**
 * 获取钉钉日志/周报
 * POST /api/v1/dingtalk/reports
 *
 * body: {
 *   userid?: string        — 钉钉 userid（不传则获取全员）
 *   start_time: number     — 开始时间（毫秒时间戳）
 *   end_time: number       — 结束时间（毫秒时间戳）
 *   template_name?: string — 模板名称（如"日报"、"周报"）
 * }
 *
 * 需要 API Key 认证（Bearer token）
 */

import { verifyApiKey } from '~~/server/utils/api-auth'
import { isDingtalkConfigured, getReportList } from '~~/server/utils/dingtalk'

defineRouteMeta({
  openAPI: {
    tags: ['钉钉集成'],
    summary: '获取钉钉日志/周报',
    description: '调用钉钉 API 获取指定时间范围内的日志或周报数据。需要 API Key 认证。'
  }
})

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

  if (!isDingtalkConfigured()) {
    throw createError({
      statusCode: 503,
      message: '钉钉未配置（缺少 DINGTALK_APP_ID / DINGTALK_APP_SECRET）'
    })
  }

  const body = await readBody(event)
  const { userid, start_time, end_time, template_name } = body || {}

  if (!start_time || !end_time) {
    throw createError({
      statusCode: 400,
      message: '缺少参数: start_time, end_time（毫秒时间戳）'
    })
  }

  const reports = await getReportList({
    userid,
    startTime: Number(start_time),
    endTime: Number(end_time),
    templateName: template_name
  })

  return {
    code: 0,
    data: {
      items: reports,
      total: reports.length
    }
  }
})
