import { publishAimsCompanyWeeklySummary } from '~~/server/utils/companyWeeklySummaryService'

export default defineEventHandler(async (event) => {
  const command = String(getRouterParam(event, 'summaryCommand') || '').trim()
  if (!command.endsWith(':publish')) {
    throw createError({ statusCode: 404, message: 'Company weekly summary service action not found.' })
  }
  const periodKey = command.slice(0, -':publish'.length)
  if (!/^[0-9]{4}-W(?:0[1-9]|[1-4][0-9]|5[0-3])$/.test(periodKey)) {
    throw createError({ statusCode: 400, message: 'Invalid company weekly summary period.' })
  }
  const data = await publishAimsCompanyWeeklySummary(event, periodKey)
  return { code: 0, data }
})
