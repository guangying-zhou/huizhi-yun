import type { H3Event } from 'h3'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { finalizeScopedDataAccess } from '@hzy/foundation/server/utils/dataAccessScope'
import type {
  FoundationScopePredicate,
  FoundationScopedAuthorizationGrant
} from '@hzy/foundation/server/utils/scopeEvaluator'
import { appCode, type PermissionAction } from '~~/app/config/permissions'

type RuntimeQuery = Record<string, unknown>

interface EmployeeScopeResult {
  access: 'all' | 'dept' | 'self' | 'none'
  deptCodes?: string[]
}

type PeopleConsoleAuth = {
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
  const consoleAuth = event.context.consoleAuth as PeopleConsoleAuth | undefined
  if (!consoleAuth?.authenticated || consoleAuth.subjectType === 'service') return null
  return consoleAuth
}

function currentPeopleDeptCodes(event: H3Event) {
  const consoleAuth = currentUserConsoleAuth(event)
  if (!consoleAuth) return []
  return uniqueStrings([
    ...splitCodes(consoleAuth.deptCodes),
    ...splitCodes(consoleAuth.deptCode),
    ...splitCodes(consoleAuth.claims?.dept_codes),
    ...splitCodes(consoleAuth.claims?.dept_code)
  ])
}

function actionMatches(granted: string, required: PermissionAction) {
  if (granted === required || granted === 'admin') return true
  return required === 'view' && granted === 'edit'
}

function permissionMatches(
  permission: { appCode: string, resourceCode: string, action: string },
  resourceCode: string,
  requiredAction: PermissionAction
) {
  return permission.appCode === appCode
    && permission.resourceCode === resourceCode
    && actionMatches(permission.action, requiredAction)
}

function isTenantGlobalScope(scope: FoundationScopePredicate) {
  return stringValue(scope.dimension) === 'tenant' && stringValue(scope.predicate) === 'global'
}

function isSubjectSelfScope(scope: FoundationScopePredicate) {
  return stringValue(scope.dimension) === 'subject' && stringValue(scope.predicate) === 'self'
}

function departmentScopeCode(scope: FoundationScopePredicate) {
  return stringValue(scope.dimension) === 'department' && stringValue(scope.predicate) === 'self'
    ? stringValue(scope.value)
    : ''
}

function employeeScopeFromGrant(
  grant: FoundationScopedAuthorizationGrant,
  currentDeptCodes: string[]
): EmployeeScopeResult {
  const scopeGroups = [
    grant.defaultScopes || [],
    grant.assignmentScopes || [],
    grant.scopes || []
  ]
    .map(scopes => scopes.filter(scope => !isTenantGlobalScope(scope)))
    .filter(scopes => scopes.length > 0)

  if (scopeGroups.length === 0) return { access: 'all' }

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

function employeeAccessQuery(result: EmployeeScopeResult): RuntimeQuery {
  const query: RuntimeQuery = {
    current_user_employee_access: result.access,
    current_user_data_access: result.access
  }
  if (result.access === 'all') {
    query.current_user_scopes = 'people:employees:admin'
  }
  if (result.access === 'dept' && result.deptCodes?.length) {
    const deptCodes = result.deptCodes.join(',')
    query.current_user_employee_dept_codes = deptCodes
    query.current_user_data_dept_codes = deptCodes
  }
  return query
}

async function loadPeopleScopedGrants(
  event: H3Event,
  uid: string,
  resourceCode: string,
  action: PermissionAction
) {
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, uid, appCode, {
    resourceCode,
    action
  })
  return scoped.grants
}

export async function resolvePeopleEmployeeAccessQuery(
  event: H3Event,
  uid: string,
  action: PermissionAction,
  resourceCode = 'employees'
): Promise<RuntimeQuery> {
  const normalizedUid = stringValue(uid)
  if (!normalizedUid) return employeeAccessQuery({ access: 'none' })

  try {
    const currentDeptCodes = currentPeopleDeptCodes(event)
    const grants = await loadPeopleScopedGrants(event, normalizedUid, resourceCode, action)

    let sawPermission = false
    let allowSelf = false
    const allowedDeptCodes: string[] = []
    for (const grant of grants) {
      if (!grant.permissions.some(permission => permissionMatches(permission, resourceCode, action))) continue
      sawPermission = true

      const scope = employeeScopeFromGrant(grant, currentDeptCodes)
      if (scope.access === 'all') {
        return employeeAccessQuery(scope)
      }
      if (scope.access === 'self') {
        allowSelf = true
      }
      if (scope.access === 'dept') {
        allowedDeptCodes.push(...(scope.deptCodes || []))
      }
    }

    return employeeAccessQuery(
      finalizeScopedDataAccess({ sawPermission, allowSelf, deptCodes: allowedDeptCodes })
    )
  } catch (error) {
    console.warn('[PeopleScopedAuthorization] failed to resolve employee scope:', error)
    throw error
  }
}
