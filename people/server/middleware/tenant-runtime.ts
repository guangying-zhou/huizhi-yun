import { createError, getRequestURL, setResponseStatus, type H3Event } from 'h3'
import { resolveConsoleAuthWithSessionBridge } from '@hzy/foundation/server/utils/consoleSessionBridge'
import { measureRequestStage } from '@hzy/foundation/server/utils/performanceTiming'
import { maybeProxyCurrentApiToTenantRuntime, type TenantRuntimeProxyContext } from '@hzy/foundation/server/utils/tenantRuntimeProxy'
import { dispatchDirectoryLifecycleOperation } from '~~/server/utils/directoryLifecycleOperation'
import {
  assertPeoplePermission,
  peoplePermissionSnapshotAllows
} from '~~/server/utils/peoplePermissions'
import { resolvePeopleEmployeeAccessQuery } from '~~/server/utils/peopleScopedAuthorization'
import { peopleEmployeeSearchRoutePolicy } from '~~/server/utils/peopleRuntimeRoutePolicy'
import { requireServiceScope } from '~~/server/utils/serviceAuth'
import type { PermissionAction } from '~~/app/config/permissions'

const APP_CODE = 'people'
const API_PREFIX = '/api/v1'

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname
  if (isAllowedLocalApiV1Path(pathname)) return

  await ensureConsoleAuthContext(event)
  await requireForwardedServiceCapability(event)
  await measureRequestStage(event, 'people_permission', () => requireRuntimeUserPermission(event))

  const runtimeResponse = await maybeProxyCurrentApiToTenantRuntime(event, {
    appCode: APP_CODE,
    shouldForward: shouldForwardPeopleRuntime,
    resolveScope: scopeFor,
    resolveQuery: (context, query) => measureRequestStage(event, 'people_scopes', () => resolvePeopleRuntimeQuery(context, query))
  })

  if (runtimeResponse !== undefined) {
    const operationKey = directoryLifecycleOperationKey(runtimeResponse)
    if (operationKey) {
      const delivery = await dispatchDirectoryLifecycleOperation(event, operationKey)
      if (delivery.pending) setResponseStatus(event, 202)
      const data = runtimeResponse && typeof runtimeResponse === 'object' && !Array.isArray(runtimeResponse)
        ? (runtimeResponse as Record<string, unknown>).data
        : null
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        ;(data as Record<string, unknown>).directoryLifecycleDelivery = delivery
      }
    }
    return runtimeResponse
  }

  if (isApiV1Path(pathname)) {
    throw createError({
      statusCode: 503,
      message: 'People tenant-runtime is required for /api/v1 data access.'
    })
  }
})

async function ensureConsoleAuthContext(event: H3Event) {
  const existing = event.context.consoleAuth as { authenticated?: unknown, reason?: unknown } | undefined
  if (existing && ('authenticated' in existing || 'reason' in existing)) return

  event.context.consoleAuth = await resolveConsoleAuthWithSessionBridge(event)
}

function scopeFor(context: TenantRuntimeProxyContext) {
  const searchPolicy = peopleEmployeeSearchRoutePolicy(context.suffix, context.method)
  const transport = searchPolicy?.transportScope || (context.method === 'GET' ? 'people.read' : 'people.write')
  const action = offboardingRuntimeAction(context.suffix, context.method)
  if (!action) return transport
  const scopes = [`people:offboarding_tasks:${action}`]
  const authorization = context.event.context as typeof context.event.context & {
    peopleOffboardingAdminAuthorized?: boolean
  }
  if (authorization.peopleOffboardingAdminAuthorized && (action === 'view' || action === 'confirm')) {
    scopes.push('people:offboarding_tasks:admin')
  }
  return `${transport} ${scopes.join(' ')}`
}

function offboardingRuntimeAction(suffix: string, method: string) {
  if (suffix === '/offboarding-cases') return method === 'GET' ? 'view' : 'admin'
  if (method === 'GET' && /^\/offboarding-cases\/[^/]+$/.test(suffix)) return 'view'
  if (method === 'POST' && /^\/offboarding-tasks\/[^/]+:confirm$/.test(suffix)) return 'confirm'
  if (method === 'POST' && /^\/offboarding-tasks\/[^/]+:cancel$/.test(suffix)) return 'cancel'
  return ''
}

function shouldForwardPeopleRuntime(context: TenantRuntimeProxyContext) {
  if (context.method === 'POST' && /^\/authorization\/instance-conflict-explain$/.test(context.suffix)) return false
  if (context.method === 'POST' && /^\/service\/workflow\/callback$/.test(context.suffix)) return false
  return true
}

const employeeAccessQueryKeys = [
  'current_user',
  'currentUser',
  'operator_uid',
  'operatorUid',
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
  'currentUserStandardCostAccess',
  'current_user_cost_snapshot_access',
  'currentUserCostSnapshotAccess',
  'current_user_cost_snapshot_dept_code',
  'currentUserCostSnapshotDeptCode',
  'current_user_cost_snapshot_dept_codes',
  'currentUserCostSnapshotDeptCodes',
  'current_user_assignment_access',
  'currentUserAssignmentAccess',
  'current_user_assignment_dept_code',
  'currentUserAssignmentDeptCode',
  'current_user_assignment_dept_codes',
  'currentUserAssignmentDeptCodes',
  'current_user_performance_cycle_access',
  'currentUserPerformanceCycleAccess',
  'current_user_performance_cycle_dept_code',
  'currentUserPerformanceCycleDeptCode',
  'current_user_performance_cycle_dept_codes',
  'currentUserPerformanceCycleDeptCodes',
  'current_user_document_access',
  'currentUserDocumentAccess',
  'current_user_document_dept_code',
  'currentUserDocumentDeptCode',
  'current_user_document_dept_codes',
  'currentUserDocumentDeptCodes'
]

function employeeRuntimeAction(context: TenantRuntimeProxyContext, resourceCode: string) {
  // 扩展人事档案包含身份证号等 HR 资料，只向能够维护员工事实的 HR
  // 角色开放。employees:view 仍用于员工自助、部门负责人等普通只读场景。
  if (resourceCode === 'employees' && /^\/employees\/[^/]+\/private-profile$/.test(context.suffix)) {
    return 'edit'
  }
  if (resourceCode === 'standard_costs' && context.method !== 'GET' && !isEmployeeSearchContext(context)) {
    return 'admin'
  }
  return context.method === 'GET' || isEmployeeSearchContext(context) ? 'view' : 'edit'
}

function text(value: unknown) {
  return String(value || '').trim()
}

function apiV1Suffix(pathname: string) {
  const index = pathname.indexOf(API_PREFIX)
  if (index < 0) return ''
  return pathname.slice(index + API_PREFIX.length) || '/'
}

function directoryLifecycleOperationKey(response: unknown) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return ''
  const data = (response as Record<string, unknown>).data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
  const lifecycle = (data as Record<string, unknown>).directoryLifecycle
  if (!lifecycle || typeof lifecycle !== 'object' || Array.isArray(lifecycle)) return ''
  return text((lifecycle as Record<string, unknown>).operationKey)
}

function employeeScopedResource(context: TenantRuntimeProxyContext) {
  if (context.suffix === '/dashboard/overview') {
    return 'employees'
  }
  if (context.suffix === '/employees'
    || context.suffix === '/employees:search'
    || /^\/employees\/[^/]+$/.test(context.suffix)
    || /^\/employees\/[^/]+\/profile$/.test(context.suffix)
    || /^\/employees\/[^/]+\/private-profile$/.test(context.suffix)) {
    return 'employees'
  }
  if (context.suffix === '/assignments'
    || context.suffix === '/assignments:change'
    || /^\/assignments\/[^/]+$/.test(context.suffix)) {
    return 'assignments'
  }
  if (context.suffix === '/cost-snapshots' || /^\/cost-snapshots\/[^/]+$/.test(context.suffix)) {
    return 'cost_snapshots'
  }
  if (context.suffix === '/documents' || /^\/documents\/[^/]+$/.test(context.suffix)) {
    return 'documents'
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

function isEmployeeRecordContext(context: TenantRuntimeProxyContext) {
  return context.suffix === '/employees'
    || context.suffix === '/employees:search'
    || /^\/employees\/[^/]+$/.test(context.suffix)
    || /^\/employees\/[^/]+\/profile$/.test(context.suffix)
}

function isEmployeeSearchContext(context: TenantRuntimeProxyContext) {
  return peopleEmployeeSearchRoutePolicy(context.suffix, context.method) !== null
}

function isDashboardOverviewContext(context: TenantRuntimeProxyContext) {
  return context.method === 'GET' && context.suffix === '/dashboard/overview'
}

function isEmployeeProfileContext(context: TenantRuntimeProxyContext) {
  return context.method === 'GET' && /^\/employees\/[^/]+\/profile$/.test(context.suffix)
}

function isAssignmentChangeContext(context: TenantRuntimeProxyContext) {
  return context.method === 'POST' && context.suffix === '/assignments:change'
}

function copyAccessQuery(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  options: {
    accessKey: string
    deptCodeKey?: string
    deptCodesKey?: string
  }
) {
  const access = text(source.current_user_employee_access)
  if (access) target[options.accessKey] = access

  const deptCodes = text(source.current_user_employee_dept_codes || source.current_user_data_dept_codes)
  if (deptCodes && options.deptCodesKey) target[options.deptCodesKey] = deptCodes

  const deptCode = text(source.current_user_employee_dept_code || source.current_user_data_dept_code)
  if (deptCode && options.deptCodeKey) target[options.deptCodeKey] = deptCode
}

async function resolvePeopleRuntimeQuery(context: TenantRuntimeProxyContext, query: Record<string, unknown>) {
  const sanitizedQuery = Object.fromEntries(
    Object.entries(query).filter(([key]) => !employeeAccessQueryKeys.includes(key))
  )

  if (isOffboardingRuntimeContext(context)) {
    const currentUser = text(context.currentUser)
    if (currentUser) {
      sanitizedQuery.current_user = currentUser
      sanitizedQuery.operator_uid = currentUser
    }
    return sanitizedQuery
  }

  const resourceCode = employeeScopedResource(context)
  if (!resourceCode) return sanitizedQuery

  // Independent scope checks may run concurrently, but all must finish before
  // forwarding any data request. Never combine grants from different resources.
  const needsStandardCosts = isDashboardOverviewContext(context) || isEmployeeRecordContext(context) || isAssignmentChangeContext(context)
  const [scopedQuery, standardCostQuery] = await Promise.all([
    resolvePeopleEmployeeAccessQuery(
      context.event,
      context.currentUser,
      employeeRuntimeAction(context, resourceCode),
      resourceCode
    ),
    needsStandardCosts
      ? resolvePeopleEmployeeAccessQuery(
          context.event,
          context.currentUser,
          context.method === 'GET' || isEmployeeSearchContext(context) ? 'view' : 'admin',
          'standard_costs'
        )
      : Promise.resolve(null)
  ])
  Object.assign(sanitizedQuery, scopedQuery)

  if (standardCostQuery) {
    copyAccessQuery(sanitizedQuery, standardCostQuery, {
      accessKey: 'current_user_standard_cost_access'
    })
  }

  if (isEmployeeProfileContext(context)) {
    const assignmentQuery = await resolvePeopleEmployeeAccessQuery(
      context.event,
      context.currentUser,
      'view',
      'assignments'
    )
    copyAccessQuery(sanitizedQuery, assignmentQuery, {
      accessKey: 'current_user_assignment_access',
      deptCodeKey: 'current_user_assignment_dept_code',
      deptCodesKey: 'current_user_assignment_dept_codes'
    })

    const costSnapshotQuery = await resolvePeopleEmployeeAccessQuery(
      context.event,
      context.currentUser,
      'view',
      'cost_snapshots'
    )
    copyAccessQuery(sanitizedQuery, costSnapshotQuery, {
      accessKey: 'current_user_cost_snapshot_access',
      deptCodeKey: 'current_user_cost_snapshot_dept_code',
      deptCodesKey: 'current_user_cost_snapshot_dept_codes'
    })

    const performanceCycleQuery = await resolvePeopleEmployeeAccessQuery(
      context.event,
      context.currentUser,
      'view',
      'performance_cycles'
    )
    copyAccessQuery(sanitizedQuery, performanceCycleQuery, {
      accessKey: 'current_user_performance_cycle_access',
      deptCodeKey: 'current_user_performance_cycle_dept_code',
      deptCodesKey: 'current_user_performance_cycle_dept_codes'
    })

    const documentQuery = await resolvePeopleEmployeeAccessQuery(
      context.event,
      context.currentUser,
      'view',
      'documents'
    )
    copyAccessQuery(sanitizedQuery, documentQuery, {
      accessKey: 'current_user_document_access',
      deptCodeKey: 'current_user_document_dept_code',
      deptCodesKey: 'current_user_document_dept_codes'
    })
  }
  return sanitizedQuery
}

function isOffboardingRuntimeContext(context: TenantRuntimeProxyContext) {
  return context.suffix === '/offboarding-cases'
    || /^\/offboarding-cases\/[^/]+$/.test(context.suffix)
    || /^\/offboarding-tasks\/[^/]+:(confirm|cancel)$/.test(context.suffix)
}

function isApiV1Path(pathname: string) {
  const index = pathname.indexOf(API_PREFIX)
  if (index < 0) return false

  const after = pathname[index + API_PREFIX.length] || ''
  return after === '' || after === '/'
}

interface ServiceCapabilityRequirement {
  scope: string
  allowedApps: string[]
}

// 动作集合以 app/config/permissions.ts 为唯一事实源；此前这里、
// peoplePermissions.ts、usePeopleAuthorization.ts 与 config 各维护一份，
// 新增动作时必然漏改。
type PeopleRuntimePermissionAction = PermissionAction

interface RuntimePermissionRequirement {
  resource: string
  action: PeopleRuntimePermissionAction
}

function serviceCapabilityRequirement(suffix: string, method: string): ServiceCapabilityRequirement | null {
  if (method === 'GET' && suffix === '/service/standard-costs:resolve') {
    return { scope: 'people:read', allowedApps: ['finance'] }
  }
  if (method === 'GET' && /^\/service\/employees\/[^/]+\/cost-snapshot$/.test(suffix)) {
    return { scope: 'people:read', allowedApps: ['finance'] }
  }
  if (method === 'GET' && /^\/service\/projects\/[^/]+\/people-costs$/.test(suffix)) {
    return { scope: 'people:read', allowedApps: ['finance'] }
  }
  if (method !== 'POST') return null

  if (suffix === '/service/directory-users:sync') {
    return { scope: 'people:write', allowedApps: ['console'] }
  }
  if (suffix === '/service/cost-snapshots:generate') {
    return { scope: 'people:write', allowedApps: ['people'] }
  }
  if (suffix === '/service/contributions:sync') {
    return { scope: 'people:write', allowedApps: ['aims'] }
  }
  if (/^\/service\/performance-cycles\/[^/]+:(confirm|close)$/.test(suffix)) {
    return { scope: 'people:write', allowedApps: ['people'] }
  }
  return null
}

async function requireForwardedServiceCapability(event: H3Event) {
  const url = getRequestURL(event)
  const method = String(event.node.req.method || 'GET').toUpperCase()
  const suffix = apiV1Suffix(url.pathname)
  const requirement = serviceCapabilityRequirement(suffix, method)
  if (!requirement) {
    if (suffix.startsWith('/service/')) {
      throw createError({
        statusCode: 403,
        message: 'Unsupported People service endpoint capability.'
      })
    }
    return
  }

  await requireServiceScope(event, requirement)
}

function writeAction(method: string, fallback: PeopleRuntimePermissionAction = 'edit') {
  if (method === 'GET') return 'view'
  if (method === 'DELETE') return 'admin'
  return fallback
}

function runtimePermissionRequirement(suffix: string, method: string): RuntimePermissionRequirement | null {
  if (suffix === '/dashboard/overview') {
    return { resource: 'dashboard', action: 'view' }
  }
  const searchPolicy = peopleEmployeeSearchRoutePolicy(suffix, method)
  if (searchPolicy) return searchPolicy.permission
  if (suffix === '/employees' || /^\/employees\/[^/]+$/.test(suffix) || /^\/employees\/[^/]+\/profile$/.test(suffix)) {
    return { resource: 'employees', action: writeAction(method) }
  }
  // 扩展人事档案向日常 HR 管理角色开放，但不向只有 employees/view 的
  // 员工自助、部门负责人和其他只读角色开放。
  if (/^\/employees\/[^/]+\/private-profile$/.test(suffix)) {
    return { resource: 'employees', action: 'edit' }
  }
  // OA 档案批量导入仍是全局管理操作。
  if (suffix === '/employee-private-profiles:import') {
    return { resource: 'employees', action: 'admin' }
  }
  if (suffix === '/assignments' || suffix === '/assignments:change' || /^\/assignments\/[^/]+$/.test(suffix)) {
    return { resource: 'assignments', action: writeAction(method) }
  }
  if (suffix === '/cost-snapshots' || /^\/cost-snapshots\/[^/]+$/.test(suffix)) {
    return { resource: 'cost_snapshots', action: writeAction(method) }
  }
  if (suffix === '/documents' || /^\/documents\/[^/]+$/.test(suffix)) {
    return { resource: 'documents', action: writeAction(method) }
  }
  if (suffix === '/standard-costs' || /^\/standard-costs\/[^/]+$/.test(suffix)) {
    return { resource: 'standard_costs', action: writeAction(method, 'admin') }
  }
  if (suffix === '/performance-cycles'
    || /^\/performance-cycles\/[^/]+$/.test(suffix)
    || /^\/performance-cycles\/[^/]+\/detail$/.test(suffix)
    || suffix === '/contribution-snapshots'
    || /^\/contribution-snapshots\/[^/]+$/.test(suffix)) {
    return { resource: 'performance_cycles', action: writeAction(method) }
  }
  if (suffix === '/positions' || /^\/positions\/[^/]+$/.test(suffix)) {
    return { resource: 'positions', action: writeAction(method, 'admin') }
  }
  if (suffix === '/ranks' || /^\/ranks\/[^/]+$/.test(suffix)) {
    return { resource: 'ranks', action: writeAction(method, 'admin') }
  }
  // 入职候选：读取与资料完善分开授权。资料完善是 HR 确认 canonical 事实的
  // 动作，不能沿用只读权限。
  if (suffix === '/onboarding-cases' || /^\/onboarding-cases\/[^/]+$/.test(suffix)) {
    return { resource: 'employees', action: method === 'GET' ? 'view' : 'edit' }
  }
  if (method === 'PATCH' && /^\/onboarding-cases\/[^/]+\/profile$/.test(suffix)) {
    return { resource: 'employees', action: 'edit' }
  }
  // 遗留主体在线归并已关闭，只保留只读预览，并继续要求最高权限。
  if (suffix === '/subject-merge:preview') {
    return { resource: 'employees', action: 'admin' }
  }
  // 开通与激活是同一条敏感动作：都会把候选真正变成企业身份与正式员工。
  if (method === 'POST' && /^\/onboarding-cases\/[^/]+:(begin-provisioning|reserved|provisioning|failure|cancel|activate|aggregate-status)$/.test(suffix)) {
    return { resource: 'employees', action: 'admin' }
  }
  if (suffix === '/offboarding-cases') {
    return { resource: 'offboarding_tasks', action: method === 'GET' ? 'view' : 'admin' }
  }
  if (method === 'GET' && /^\/offboarding-cases\/[^/]+$/.test(suffix)) {
    return { resource: 'offboarding_tasks', action: 'view' }
  }
  if (method === 'POST' && /^\/offboarding-tasks\/[^/]+:confirm$/.test(suffix)) {
    return { resource: 'offboarding_tasks', action: 'confirm' }
  }
  if (method === 'POST' && /^\/offboarding-tasks\/[^/]+:cancel$/.test(suffix)) {
    return { resource: 'offboarding_tasks', action: 'cancel' }
  }
  return null
}

async function requireRuntimeUserPermission(event: H3Event) {
  const url = getRequestURL(event)
  const suffix = apiV1Suffix(url.pathname)
  if (!suffix || suffix.startsWith('/service/')) return

  const method = String(event.node.req.method || 'GET').toUpperCase()
  const requirement = runtimePermissionRequirement(suffix, method)
  if (!requirement) {
    throw createError({
      statusCode: 403,
      message: 'Unsupported People runtime endpoint permission.'
    })
  }

  const snapshot = await assertPeoplePermission(event, requirement.resource, requirement.action)
  if (requirement.resource === 'offboarding_tasks') {
    const authorization = event.context as typeof event.context & {
      peopleOffboardingAdminAuthorized?: boolean
    }
    authorization.peopleOffboardingAdminAuthorized = peoplePermissionSnapshotAllows(
      snapshot,
      'offboarding_tasks',
      'admin'
    )
  }
}

function isAllowedLocalApiV1Path(pathname: string) {
  const index = pathname.indexOf(API_PREFIX)
  if (index < 0) return false
  const apiPath = pathname.slice(index)
  return /^\/api\/v1\/authorization\/instance-conflict-explain$/.test(apiPath)
    || /^\/api\/v1\/service\/workflow\/callback$/.test(apiPath)
    || /^\/api\/v1\/service\/notification-details\/authorize$/.test(apiPath)
    || /^\/api\/v1\/integration-operations(?:\/[^/]+\/(?:replay|attempts))?$/.test(apiPath)
}
