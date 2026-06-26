import { createError, defineEventHandler, getRouterParam } from 'h3'
import { projectFinanceDetail } from '../../../../../utils/financeReports'
import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime<Awaited<ReturnType<typeof projectFinanceDetail>>>(event)
  if (runtime.handled) return runtime.data

  const projectCode = String(getRouterParam(event, 'projectCode') || '').trim()
  if (!projectCode) {
    throw createError({ statusCode: 400, statusMessage: 'projectCode is required' })
  }

  return projectFinanceDetail(projectCode)
})
