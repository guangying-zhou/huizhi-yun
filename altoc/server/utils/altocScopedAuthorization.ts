import type { H3Event } from 'h3'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { finalizeScopedDataAccess } from '@hzy/foundation/server/utils/dataAccessScope'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { hasAltocGlobalAdminRole } from '~~/server/utils/globalAdminAuthorization'
import type {
  FoundationScopePredicate,
  FoundationScopedAuthorizationGrant
} from '@hzy/foundation/server/utils/scopeEvaluator'
import { appCode, type PermissionAction } from '~~/app/config/permissions'

type RuntimeQuery = Record<string, unknown>
type AltocDataAccess = 'all' | 'dept' | 'self' | 'none'

interface AltocScopeResult {
  access: AltocDataAccess
  deptCodes: string[]
}

type AltocConsoleAuth = {
  authenticated?: boolean
  subjectType?: string | null
  deptCode?: string | null
  deptCodes?: string[] | string | null
  claims?: Record<string, unknown> | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map(item => item.trim()).filter(Boolean)))
}

function splitCodes(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(item => splitCodes(item))
  return String(value || '')
    .split(/[,\s;]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function currentUserConsoleAuth(event: H3Event) {
  const consoleAuth = event.context.consoleAuth as AltocConsoleAuth | undefined
  if (!consoleAuth?.authenticated || consoleAuth.subjectType === 'service') return null
  return consoleAuth
}

export function currentAltocDeptCodes(event: H3Event) {
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

function permissionMatches(permission: { appCode: string, resourceCode: string, action: string }, resource: string, action: PermissionAction) {
  return permission.appCode === appCode
    && permission.resourceCode === resource
    && actionMatches(permission.action, action)
}

function isTenantGlobalScope(scope: FoundationScopePredicate) {
  return stringValue(scope.dimension) === 'tenant' && stringValue(scope.predicate) === 'global'
}

function isOwnerScope(scope: FoundationScopePredicate) {
  const dimension = stringValue(scope.dimension)
  const predicate = stringValue(scope.predicate)
  return (dimension === 'subject' && predicate === 'self')
    || (dimension === 'customer' && predicate === 'owner')
    || (dimension === 'object' && predicate === 'assigned')
}

function departmentScopeCode(scope: FoundationScopePredicate) {
  return stringValue(scope.dimension) === 'department' && stringValue(scope.predicate) === 'self'
    ? stringValue(scope.value)
    : ''
}

function intersectDeptCodes(left: string[], right: string[]) {
  if (!left.length) return uniqueStrings(right)
  const rightSet = new Set(right)
  return left.filter(item => rightSet.has(item))
}

function grantScopeResult(grant: FoundationScopedAuthorizationGrant, currentDeptCodes: string[]): AltocScopeResult {
  const scopeGroups = [
    grant.defaultScopes || [],
    grant.assignmentScopes || [],
    grant.scopes || []
  ]
    .map(scopes => scopes.filter(scope => !isTenantGlobalScope(scope)))
    .filter(scopes => scopes.length > 0)

  if (scopeGroups.length === 0) return { access: 'all', deptCodes: [] }

  let sawOwnerScope = false
  let deptCodes: string[] = []
  let sawDeptScope = false

  for (const scopes of scopeGroups) {
    const ownerOnly = scopes.every(isOwnerScope)
    if (ownerOnly) {
      sawOwnerScope = true
      continue
    }

    const groupDeptCodes = uniqueStrings(scopes.map(departmentScopeCode).filter(Boolean))
    const departmentSelfWithoutValue = scopes.some(scope => (
      stringValue(scope.dimension) === 'department'
      && stringValue(scope.predicate) === 'self'
      && !stringValue(scope.value)
    ))
    const departmentOnly = scopes.every(scope => departmentScopeCode(scope) || (
      stringValue(scope.dimension) === 'department'
      && stringValue(scope.predicate) === 'self'
      && !stringValue(scope.value)
    ))
    if (departmentOnly) {
      sawDeptScope = true
      const resolvedDeptCodes = groupDeptCodes.length ? groupDeptCodes : currentDeptCodes
      deptCodes = intersectDeptCodes(deptCodes, resolvedDeptCodes)
      if (!deptCodes.length && !departmentSelfWithoutValue) return { access: 'none', deptCodes: [] }
      continue
    }

    return { access: 'none', deptCodes: [] }
  }

  if (sawOwnerScope && sawDeptScope) return { access: 'none', deptCodes: [] }
  if (sawDeptScope && deptCodes.length > 0) return { access: 'dept', deptCodes }
  if (sawOwnerScope && !sawDeptScope) return { access: 'self', deptCodes: [] }
  return { access: 'none', deptCodes: [] }
}

function accessQuery(result: AltocScopeResult): RuntimeQuery {
  const query: RuntimeQuery = {
    current_user_altoc_access: result.access,
    current_user_data_access: result.access
  }
  if (result.access === 'dept' && result.deptCodes.length > 0) {
    const joined = result.deptCodes.join(',')
    query.current_user_altoc_dept_codes = joined
    query.current_user_data_dept_codes = joined
  }
  return query
}

export async function resolveAltocDataAccessQuery(
  event: H3Event,
  uid: string,
  currentDeptCodes: string[],
  resource: string,
  action: PermissionAction
): Promise<RuntimeQuery> {
  const normalizedUid = stringValue(uid)
  if (!normalizedUid) return accessQuery({ access: 'none', deptCodes: [] })

  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, normalizedUid, appCode, {
    resourceCode: resource,
    action
  })
  if (hasAltocGlobalAdminRole(scoped.roles)) {
    return accessQuery({ access: 'all', deptCodes: [] })
  }

  let sawPermission = false
  let allowSelf = false
  const allowedDeptCodes: string[] = []

  for (const grant of scoped.grants) {
    if (!grant.permissions.some(permission => permissionMatches(permission, resource, action))) continue
    sawPermission = true

    const result = grantScopeResult(grant, currentDeptCodes)
    if (result.access === 'all') return accessQuery(result)
    if (result.access === 'self') allowSelf = true
    if (result.access === 'dept') allowedDeptCodes.push(...result.deptCodes)
  }

  return accessQuery(finalizeScopedDataAccess({ sawPermission, allowSelf, deptCodes: allowedDeptCodes }))
}

export async function resolveCurrentAltocDataAccessQuery(
  event: H3Event,
  resource: string,
  action: PermissionAction
): Promise<RuntimeQuery> {
  return resolveAltocDataAccessQuery(
    event,
    getRequestUid(event),
    currentAltocDeptCodes(event),
    resource,
    action
  )
}
