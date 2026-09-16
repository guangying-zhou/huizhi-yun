import type { H3Event } from 'h3'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { finalizeScopedDataAccess } from '@hzy/foundation/server/utils/dataAccessScope'
import type {
  FoundationScopePredicate,
  FoundationScopedAuthorizationGrant
} from '@hzy/foundation/server/utils/scopeEvaluator'
import {
  authorizationActionsAllow,
  type ResourceActionPolicy
} from '@hzy/foundation/shared/utils/authorizationActions'
import { appCode, type PermissionAction } from '~~/app/config/permissions'

type RuntimeQuery = Record<string, unknown>

interface ExpenseRequestScopeResult {
  access: 'all' | 'dept' | 'self' | 'none'
  deptCodes?: string[]
}

interface FinancePerformanceScopeResult {
  access: 'all' | 'dept' | 'self' | 'none'
  deptCodes?: string[]
}

interface ProjectFinanceScopeResult {
  access: 'all' | 'projects' | 'none'
  projectCodes?: string[]
}

export type FinanceResponsibilityAccess = 'all' | 'relation' | 'none'

type FinanceConsoleAuth = {
  authenticated?: boolean
  subjectType?: string | null
  deptCode?: string | null
  deptCodes?: string[] | string | null
  claims?: Record<string, unknown> | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function splitCodes(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(item => splitCodes(item))
  return String(value || '')
    .split(/[,\s;]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map(item => item.trim()).filter(Boolean)))
}

function currentUserConsoleAuth(event: H3Event) {
  const consoleAuth = event.context.consoleAuth as FinanceConsoleAuth | undefined
  if (!consoleAuth?.authenticated || consoleAuth.subjectType === 'service') return null
  return consoleAuth
}

function currentFinanceDeptCodes(event: H3Event) {
  const consoleAuth = currentUserConsoleAuth(event)
  if (!consoleAuth) return []
  return uniqueStrings([
    ...splitCodes(consoleAuth.deptCodes),
    ...splitCodes(consoleAuth.deptCode),
    ...splitCodes(consoleAuth.claims?.dept_codes),
    ...splitCodes(consoleAuth.claims?.dept_code)
  ])
}

function permissionMatches(
  permission: { appCode: string, resourceCode: string, action: string },
  resourceCode: string,
  requiredAction: PermissionAction,
  policy?: ResourceActionPolicy
) {
  if (permission.appCode !== appCode || permission.resourceCode !== resourceCode) return false
  return authorizationActionsAllow([permission.action], requiredAction, policy)
}

function isTenantGlobalScope(scope: FoundationScopePredicate) {
  return stringValue(scope.dimension) === 'tenant' && stringValue(scope.predicate) === 'global'
}

// 区分「显式授予了全局范围」与「压根没配过范围」。
//
// 走查 ISSUE-B-011：三处范围解析都先滤掉 tenant:global 再判断剩余是否为空，
// 于是这两种情况被折叠成同一个结果 access='all'。生产 tenant_role_scopes 与
// platform_app_role_scopes 都是空表，所有未配范围的角色因此拿到全量访问——
// 4 个非财务岗位据此可读全库发票、到账、报销与项目毛利。
//
// 未配置范围必须失败关闭；全量访问只能由显式的 tenant:global 授予。
function hasExplicitTenantGlobalScope(grant: FoundationScopedAuthorizationGrant) {
  return [
    grant.defaultScopes || [],
    grant.assignmentScopes || [],
    grant.scopes || []
  ].some(scopes => scopes.some(isTenantGlobalScope))
}

function isSubjectSelfScope(scope: FoundationScopePredicate) {
  return stringValue(scope.dimension) === 'subject' && stringValue(scope.predicate) === 'self'
}

function departmentScopeCode(scope: FoundationScopePredicate) {
  return stringValue(scope.dimension) === 'department' && stringValue(scope.predicate) === 'self'
    ? stringValue(scope.value)
    : ''
}

function projectScopeCode(scope: FoundationScopePredicate) {
  const dimension = stringValue(scope.dimension)
  const predicate = stringValue(scope.predicate)
  const value = stringValue(scope.value)
  if (dimension !== 'project' || !value) return ''
  return predicate === 'code' ? value : ''
}

function responsibilityScopeFromGrant(grant: FoundationScopedAuthorizationGrant): FinanceResponsibilityAccess {
  const scopeGroups = [
    grant.defaultScopes || [],
    grant.assignmentScopes || [],
    grant.scopes || []
  ]
    .map(scopes => scopes.filter(scope => !isTenantGlobalScope(scope)))
    .filter(scopes => scopes.length > 0)

  if (scopeGroups.length === 0) return hasExplicitTenantGlobalScope(grant) ? 'all' : 'none'
  return scopeGroups.every(scopes => scopes.every(isSubjectSelfScope)) ? 'relation' : 'none'
}

async function loadFinanceScopedGrants(
  event: H3Event,
  uid: string,
  resourceCode: string,
  action: PermissionAction
) {
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, uid, appCode, {
    resourceCode,
    action
  })
  return scoped
}

export function resolveFinanceResponsibilityAccessFromGrants(
  grants: FoundationScopedAuthorizationGrant[],
  resourceCode: string,
  action: PermissionAction,
  actionPolicy?: ResourceActionPolicy
): FinanceResponsibilityAccess {
  let relation = false
  for (const grant of grants) {
    if (!grant.permissions.some(permission => permissionMatches(permission, resourceCode, action, actionPolicy))) continue
    const access = responsibilityScopeFromGrant(grant)
    if (access === 'all') return 'all'
    if (access === 'relation') relation = true
  }
  return relation ? 'relation' : 'none'
}

export async function resolveFinanceResponsibilityAccessQuery(
  event: H3Event,
  uid: string,
  resourceCode: 'invoices' | 'receipts' | 'reconciliation',
  action: PermissionAction,
  target: 'invoice_request' | 'receipt'
): Promise<RuntimeQuery> {
  const key = target === 'invoice_request'
    ? 'current_user_invoice_request_access'
    : 'current_user_receipt_access'
  const normalizedUid = stringValue(uid)
  if (!normalizedUid) return { [key]: 'none' }

  try {
    const scoped = await loadFinanceScopedGrants(event, normalizedUid, resourceCode, action)
    return {
      [key]: resolveFinanceResponsibilityAccessFromGrants(
        scoped.grants,
        resourceCode,
        action,
        scoped.actionPolicy
      )
    }
  } catch (error) {
    console.warn(`[FinanceScopedAuthorization] failed to resolve ${target} responsibility scope:`, error)
    throw error
  }
}

function expenseRequestScopeFromGrant(
  grant: FoundationScopedAuthorizationGrant,
  currentDeptCodes: string[]
): ExpenseRequestScopeResult {
  const scopeGroups = [
    grant.defaultScopes || [],
    grant.assignmentScopes || [],
    grant.scopes || []
  ]
    .map(scopes => scopes.filter(scope => !isTenantGlobalScope(scope)))
    .filter(scopes => scopes.length > 0)

  if (scopeGroups.length === 0) {
    return { access: hasExplicitTenantGlobalScope(grant) ? 'all' : 'none' }
  }

  let sawSelf = false
  const deptCodes: string[] = []

  for (const scopes of scopeGroups) {
    if (scopes.every(isSubjectSelfScope)) {
      sawSelf = true
      continue
    }

    const groupDeptCodes = uniqueStrings(scopes.map(departmentScopeCode).filter(Boolean))
    const departmentOnly = scopes.every(scope => (
      departmentScopeCode(scope)
      || (stringValue(scope.dimension) === 'department' && stringValue(scope.predicate) === 'self' && !stringValue(scope.value))
    ))
    if (departmentOnly) {
      deptCodes.push(...(groupDeptCodes.length > 0 ? groupDeptCodes : currentDeptCodes))
      continue
    }

    return { access: 'none' }
  }

  const allowedDeptCodes = uniqueStrings(deptCodes)
  if (allowedDeptCodes.length > 0) return { access: 'dept', deptCodes: allowedDeptCodes }
  if (sawSelf) return { access: 'self' }
  return { access: 'none' }
}

function accessQuery(result: ExpenseRequestScopeResult): RuntimeQuery {
  const query: RuntimeQuery = {
    current_user_expense_request_access: result.access
  }
  if (result.access === 'dept' && result.deptCodes?.length) {
    query.current_user_expense_request_dept_codes = result.deptCodes.join(',')
  }
  return query
}

function financePerformanceAccessQuery(result: FinancePerformanceScopeResult): RuntimeQuery {
  const query: RuntimeQuery = {
    current_user_finance_performance_access: result.access
  }
  if (result.access === 'dept' && result.deptCodes?.length) {
    query.current_user_finance_performance_dept_codes = result.deptCodes.join(',')
  }
  return query
}

function projectFinanceScopeFromGrant(grant: FoundationScopedAuthorizationGrant): ProjectFinanceScopeResult {
  const scopeGroups = [
    grant.defaultScopes || [],
    grant.assignmentScopes || [],
    grant.scopes || []
  ]
    .map(scopes => scopes.filter(scope => !isTenantGlobalScope(scope)))
    .filter(scopes => scopes.length > 0)

  if (scopeGroups.length === 0) {
    return { access: hasExplicitTenantGlobalScope(grant) ? 'all' : 'none' }
  }

  let allowedCodes: string[] | null = null
  for (const scopes of scopeGroups) {
    const dimensions = new Set(scopes.map(scope => stringValue(scope.dimension)).filter(Boolean))
    if (dimensions.size !== 1 || !dimensions.has('project')) {
      return { access: 'none' }
    }

    const groupCodes = uniqueStrings(scopes.map(projectScopeCode).filter(Boolean))
    if (groupCodes.length === 0) {
      return { access: 'none' }
    }
    allowedCodes = allowedCodes === null
      ? groupCodes
      : allowedCodes.filter(code => groupCodes.includes(code))
  }

  const projectCodes = uniqueStrings(allowedCodes || [])
  return projectCodes.length > 0
    ? { access: 'projects', projectCodes }
    : { access: 'none' }
}

function projectFinanceAccessQuery(result: ProjectFinanceScopeResult): RuntimeQuery {
  const query: RuntimeQuery = {
    current_user_project_finance_access: result.access
  }
  if (result.access === 'projects' && result.projectCodes?.length) {
    query.current_user_project_finance_project_codes = result.projectCodes.join(',')
  }
  return query
}

export async function resolveFinanceExpenseRequestAccessQuery(
  event: H3Event,
  uid: string,
  action: PermissionAction
): Promise<RuntimeQuery> {
  const normalizedUid = stringValue(uid)
  if (!normalizedUid) return {}

  try {
    const currentDeptCodes = currentFinanceDeptCodes(event)
    const scoped = await loadFinanceScopedGrants(event, normalizedUid, 'expenses', action)

    let sawPermission = false
    let allowSelf = false
    const allowedDeptCodes: string[] = []
    for (const grant of scoped.grants) {
      if (!grant.permissions.some(permission => permissionMatches(permission, 'expenses', action, scoped.actionPolicy))) continue
      sawPermission = true

      const scope = expenseRequestScopeFromGrant(grant, currentDeptCodes)
      if (scope.access === 'all') {
        return accessQuery(scope)
      }
      if (scope.access === 'self') {
        allowSelf = true
      }
      if (scope.access === 'dept') {
        allowedDeptCodes.push(...(scope.deptCodes || []))
      }
    }

    return accessQuery(
      finalizeScopedDataAccess({ sawPermission, allowSelf, deptCodes: allowedDeptCodes })
    )
  } catch (error) {
    console.warn('[FinanceScopedAuthorization] failed to resolve expense request scope:', error)
    throw error
  }
}

export function financeProjectAccountingScopeQuery(
  scoped: { grants: FoundationScopedAuthorizationGrant[], actionPolicy?: ResourceActionPolicy },
  action: PermissionAction
): RuntimeQuery {
  let sawPermission = false
  const allowedProjectCodes: string[] = []
  for (const grant of scoped.grants) {
    if (!grant.permissions.some(permission => permissionMatches(permission, 'project_accounting', action, scoped.actionPolicy))) continue
    sawPermission = true

    const scope = projectFinanceScopeFromGrant(grant)
    if (scope.access === 'all') {
      return projectFinanceAccessQuery(scope)
    }
    if (scope.access === 'projects') {
      allowedProjectCodes.push(...(scope.projectCodes || []))
    }
  }

  const projectCodes = uniqueStrings(allowedProjectCodes)
  if (projectCodes.length > 0) {
    return projectFinanceAccessQuery({ access: 'projects', projectCodes })
  }
  if (sawPermission) {
    return projectFinanceAccessQuery({ access: 'none' })
  }
  return projectFinanceAccessQuery({ access: 'none' })
}

export async function resolveFinanceProjectAccountingAccessQuery(
  event: H3Event,
  uid: string,
  action: PermissionAction
): Promise<RuntimeQuery> {
  const normalizedUid = stringValue(uid)
  if (!normalizedUid) return {}

  try {
    const scoped = await loadFinanceScopedGrants(event, normalizedUid, 'project_accounting', action)

    return financeProjectAccountingScopeQuery(scoped, action)
  } catch (error) {
    console.warn('[FinanceScopedAuthorization] failed to resolve project accounting scope:', error)
    throw error
  }
}

export async function resolveFinanceDashboardAccessQuery(
  event: H3Event,
  uid: string,
  action: PermissionAction
): Promise<RuntimeQuery> {
  const normalizedUid = stringValue(uid)
  if (!normalizedUid) return {}

  try {
    const scoped = await loadFinanceScopedGrants(event, normalizedUid, 'dashboard', action)

    let sawPermission = false
    const allowedProjectCodes: string[] = []
    for (const grant of scoped.grants) {
      if (!grant.permissions.some(permission => permissionMatches(permission, 'dashboard', action, scoped.actionPolicy))) continue
      sawPermission = true

      const scope = projectFinanceScopeFromGrant(grant)
      if (scope.access === 'all') {
        return projectFinanceAccessQuery(scope)
      }
      if (scope.access === 'projects') {
        allowedProjectCodes.push(...(scope.projectCodes || []))
      }
    }

    const projectCodes = uniqueStrings(allowedProjectCodes)
    if (projectCodes.length > 0) {
      return projectFinanceAccessQuery({ access: 'projects', projectCodes })
    }
    if (sawPermission) {
      return projectFinanceAccessQuery({ access: 'none' })
    }
    return projectFinanceAccessQuery({ access: 'none' })
  } catch (error) {
    console.warn('[FinanceScopedAuthorization] failed to resolve dashboard scope:', error)
    throw error
  }
}

export async function resolveFinanceContractSummaryAccessQuery(
  event: H3Event,
  uid: string,
  action: PermissionAction
): Promise<RuntimeQuery> {
  const normalizedUid = stringValue(uid)
  if (!normalizedUid) return {}

  try {
    const scoped = await loadFinanceScopedGrants(event, normalizedUid, 'invoices', action)

    let sawPermission = false
    const allowedProjectCodes: string[] = []
    for (const grant of scoped.grants) {
      if (!grant.permissions.some(permission => permissionMatches(permission, 'invoices', action, scoped.actionPolicy))) continue
      sawPermission = true

      const scope = projectFinanceScopeFromGrant(grant)
      if (scope.access === 'all') {
        return projectFinanceAccessQuery(scope)
      }
      if (scope.access === 'projects') {
        allowedProjectCodes.push(...(scope.projectCodes || []))
      }
    }

    const projectCodes = uniqueStrings(allowedProjectCodes)
    if (projectCodes.length > 0) {
      return projectFinanceAccessQuery({ access: 'projects', projectCodes })
    }
    if (sawPermission) {
      return projectFinanceAccessQuery({ access: 'none' })
    }
    return projectFinanceAccessQuery({ access: 'none' })
  } catch (error) {
    console.warn('[FinanceScopedAuthorization] failed to resolve contract summary scope:', error)
    throw error
  }
}

export async function resolveFinancePerformanceAccessQuery(
  event: H3Event,
  uid: string,
  action: PermissionAction
): Promise<RuntimeQuery> {
  const normalizedUid = stringValue(uid)
  if (!normalizedUid) return {}

  try {
    const currentDeptCodes = currentFinanceDeptCodes(event)
    const scoped = await loadFinanceScopedGrants(event, normalizedUid, 'performance', action)

    let sawPermission = false
    let allowSelf = false
    const allowedDeptCodes: string[] = []
    for (const grant of scoped.grants) {
      if (!grant.permissions.some(permission => permissionMatches(permission, 'performance', action, scoped.actionPolicy))) continue
      sawPermission = true

      const scope = expenseRequestScopeFromGrant(grant, currentDeptCodes)
      if (scope.access === 'all') {
        return financePerformanceAccessQuery(scope)
      }
      if (scope.access === 'self') {
        allowSelf = true
      }
      if (scope.access === 'dept') {
        allowedDeptCodes.push(...(scope.deptCodes || []))
      }
    }

    return financePerformanceAccessQuery(
      finalizeScopedDataAccess({ sawPermission, allowSelf, deptCodes: allowedDeptCodes })
    )
  } catch (error) {
    console.warn('[FinanceScopedAuthorization] failed to resolve finance performance scope:', error)
    throw error
  }
}
