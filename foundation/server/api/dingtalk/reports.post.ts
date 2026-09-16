import { fetchDingTalkReports } from '../../utils/dingtalkIntegration'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    userid?: string
    start_time?: number
    startTime?: number
    end_time?: number
    endTime?: number
    template_name?: string
    templateName?: string
    integrationCode?: string
  }>(event)

  const userid = String(body.userid || '').trim()
  const startTime = Number(body.start_time || body.startTime || 0)
  const endTime = Number(body.end_time || body.endTime || 0)
  if (!userid || !startTime || !endTime) {
    throw createError({ statusCode: 400, message: 'userid, start_time and end_time are required' })
  }

  const items = await fetchDingTalkReports({
    userid,
    startTime,
    endTime,
    templateName: body.template_name || body.templateName,
    integrationCode: body.integrationCode
  })

  return {
    code: 0,
    data: {
      items,
      total: items.length
    }
  }
})
