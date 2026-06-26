import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'
import { defineEventHandler, readBody } from 'h3'
import { recalculateProjectFinance, periodMonth } from '../../../../utils/financeCalculation'
import { cleanString } from '../../../../utils/financeWrite'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  const body = await readBody<Record<string, unknown>>(event)
  const data = await recalculateProjectFinance({
    projectCode: cleanString(body.projectCode ?? body.project_code),
    periodMonth: body.periodMonth || body.period_month ? periodMonth(body.periodMonth ?? body.period_month) : null,
    calculatedBy: cleanString(body.calculatedBy ?? body.calculated_by)
  })
  return { data }
})
