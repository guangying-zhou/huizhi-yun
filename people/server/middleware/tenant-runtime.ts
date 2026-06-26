import { createError, getRequestURL } from 'h3'
import { maybeProxyCurrentApiToTenantRuntime, type TenantRuntimeProxyContext } from '@hzy/foundation/server/utils/tenantRuntimeProxy'
import { resolvePeopleEmployeeAccessQuery } from '~~/server/utils/peopleScopedAuthorization'

const APP_CODE = 'people'
const API_PREFIX = '/api/v1'

export default defineEventHandler(async (event) => {
  const runtimeResponse = await maybeProxyCurrentApiToTenantRuntime(event, {
    appCode: APP_CODE,
    shouldForward: shouldForwardPeopleRuntime,
    resolveScope: scopeFor,
    resolveQuery: resolvePeopleRuntimeQuery
  })

  if (runtimeResponse !== undefined) return runtimeResponse

  const pathname = getRequestURL(event).pathname
  if (isApiV1Path(pathname)) {
    throw createError({
      statusCode: 503,
      message: 'People tenant-runtime is required for /api/v1 data access.'
    })
  }
})

function scopeFor(context: TenantRuntimeProxyContext) {
  return context.method === 'GET' ? 'people.read' : 'people.write'
}

function shouldForwardPeopleRuntime(_context: TenantRuntimeProxyContext) {
  return true
}

const employeeAccessQueryKeys = [
  'current_user_employee_access',
  'currentUserEmployeeAccess',
  'current_user_employee_dept_code',
  'currentUserEmployeeDeptCode',
  'current_user_employee_dept_codes',
  'currentUserEmployeeDeptCodes',
  'current_user_data_access',
  'currentUserDataAccess',
  'current_user_data_dept_code',
  'currentUserDataDeptCode',
  'current_user_data_dept_codes',
  'currentUserDataDeptCodes',
  'current_user_standard_cost_access',
  'currentUserStandardCostAccess'
]

function employeeRuntimeAction(method: string, resourceCode: string) {
  if (resourceCode === 'standard_costs' && method !== 'GET') {
    return 'admin'
  }
  return method === 'GET' ? 'view' : 'edit'
}

function text(value: unknown) {
  return String(value || '').trim()
}

function employeeScopedResource(context: TenantRuntimeProxyContext) {
  if (context.suffix === '/employees'
    || /^\/employees\/[^/]+$/.test(context.suffix)
    || /^\/employees\/[^/]+\/profile$/.test(context.suffix)) {
    return 'employees'
  }
  if (context.suffix === '/assignments' || /^\/assignments\/[^/]+$/.test(context.suffix)) {
    return 'assignments'
  }
  if (context.suffix === '/cost-snapshots' || /^\/cost-snapshots\/[^/]+$/.test(context.suffix)) {
    return 'cost_snapshots'
  }
  if (context.suffix === '/standard-costs' || /^\/standard-costs\/[^/]+$/.test(context.suffix)) {
    return 'standard_costs'
  }
  if (context.suffix === '/performance-cycles'
    || /^\/performance-cycles\/[^/]+$/.test(context.suffix)
    || /^\/performance-cycles\/[^/]+\/detail$/.test(context.suffix)
    || context.suffix === '/contribution-snapshots'
    || /^\/contribution-snapshots\/[^/]+$/.test(context.suffix)) {
    return 'performance_cycles'
  }
  return ''
}

function isEmployeeWriteContext(context: TenantRuntimeProxyContext) {
  return context.method !== 'GET' && (
    context.suffix === '/employees'
    || /^\/employees\/[^/]+$/.test(context.suffix)
  )
}

async function resolvePeopleRuntimeQuery(context: TenantRuntimeProxyContext, query: Record<string, unknown>) {
  const sanitizedQuery = Object.fromEntries(
    Object.entries(query).filter(([key]) => !employeeAccessQueryKeys.includes(key))
  )

  const resourceCode = employeeScopedResource(context)
  if (!resourceCode) return sanitizedQuery

  const scopedQuery = await resolvePeopleEmployeeAccessQuery(
    context.event,
    context.currentUser,
    employeeRuntimeAction(context.method, resourceCode),
    resourceCode
  )
  Object.assign(sanitizedQuery, scopedQuery)

  if (isEmployeeWriteContext(context)) {
    const standardCostQuery = await resolvePeopleEmployeeAccessQuery(
      context.event,
      context.currentUser,
      'admin',
      'standard_costs'
    )
    sanitizedQuery.current_user_standard_cost_access = text(standardCostQuery.current_user_employee_access)
  }
  return sanitizedQuery
}

function isApiV1Path(pathname: string) {
  const index = pathname.indexOf(API_PREFIX)
  if (index < 0) return false

  const after = pathname[index + API_PREFIX.length] || ''
  return after === '' || after === '/'
}
