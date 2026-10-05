import { createError, readBody } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { appCode } from '~~/app/config/permissions'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'
import { effectiveDateFromPeriodMonth, fetchFinanceCostParameters } from '~~/server/utils/financeCostParameters'

interface ApiResponse<T> {
  code: number
  data: T
  message?: string
}

type RequestBody = Record<string, unknown>

function text(value: unknown) {
  return String(value || '').trim()
}

function currentPeriodMonth() {
  return new Date().toISOString().slice(0, 7)
}

function periodMonthFromBody(body: RequestBody) {
  const periodMonth = text(body.periodMonth || body.period_month) || currentPeriodMonth()
  if (!/^\d{4}-\d{2}$/.test(periodMonth)) {
    throw createError({ statusCode: 400, message: 'periodMonth must be YYYY-MM.' })
  }
  return periodMonth
}

export default defineEventHandler(async (event) => {
  const body = await readBody<RequestBody>(event).catch(() => ({} as RequestBody))
  delete body.activeRoleCode
  delete body.active_role_code
  const snapshot = await assertPeoplePermission(event, 'cost_snapshots', 'admin')
  const periodMonth = periodMonthFromBody(body)
  const costParameters = await fetchFinanceCostParameters(event, effectiveDateFromPeriodMonth(periodMonth))
  const operatorQuery = snapshot.uid
    ? { current_user: snapshot.uid, operator_uid: snapshot.uid }
    : {}

  const runtime = await maybeCallTenantRuntime<ApiResponse<Record<string, unknown>>>(event, '/v1/people/service/cost-snapshots:generate', {
    appCode,
    scope: 'people.write',
    method: 'POST',
    query: operatorQuery,
    body: {
      ...body,
      periodMonth,
      costParameters,
      currentUser: snapshot.uid || undefined
    }
  })

  if (!runtime.handled) {
    throw createError({
      statusCode: 503,
      message: 'People tenant-runtime is not configured'
    })
  }

  return runtime.data
})
