import type {
  FoundationScopePredicate,
  FoundationScopedAuthorizationGrant
} from '@hzy/foundation/server/utils/scopeEvaluator'
import {
  authorizationActionsAllow,
  type ResourceActionPolicy
} from '@hzy/foundation/shared/utils/authorizationActions'

type RuntimeQuery = Record<string, unknown>
type AltocDataAccess = 'all' | 'dept' | 'self' | 'self_dept' | 'none'
type AltocDepartmentTreeCodeIndex = Record<string, string[]>

// This stays in the pure compiler so other authenticated hosts can preserve
// Altoc's administrator semantics without importing its event/cache wrapper.
export const ALTOC_GLOBAL_ADMIN_ROLE_CODES = [
  'system_admin',
  'super_admin',
  'platform:admin',
  'platform:super_admin'
] as const

interface AltocScopeResult {
  access: AltocDataAccess
  deptCodes: string[]
}

export interface AltocDepartmentScopeTreeNode {
  deptCode?: unknown
  dept_code?: unknown
  code?: unknown
  children?: AltocDepartmentScopeTreeNode[] | null
}

export interface ResolveAltocDataAccessFromGrantsInput {
  appCode: string
  grants: FoundationScopedAuthorizationGrant[]
  currentDeptCodes: string[]
  resource: string
  action: string
  actionPolicy?: ResourceActionPolicy
  hasGlobalAdminRole?: boolean
  departmentTreeCodesByRoot?: AltocDepartmentTreeCodeIndex
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map(item => item.trim()).filter(Boolean)))
}

function departmentNodeCode(node: AltocDepartmentScopeTreeNode) {
  return stringValue(node.deptCode || node.dept_code || node.code)
}

export function buildAltocDepartmentTreeCodeIndex(nodes: AltocDepartmentScopeTreeNode[] = []): AltocDepartmentTreeCodeIndex {
  const index: AltocDepartmentTreeCodeIndex = {}

  const collect = (node: AltocDepartmentScopeTreeNode): string[] => {
    const code = departmentNodeCode(node)
    const childCodes = (node.children || []).flatMap(child => collect(child))
    const subtreeCodes = uniqueStrings([code, ...childCodes])
    if (code) index[code] = subtreeCodes
    return subtreeCodes
  }

  for (const node of nodes) collect(node)
  return index
}

export function hasAltocGlobalAdminRole(roles: Iterable<string>) {
  const adminRoleCodes = new Set<string>(ALTOC_GLOBAL_ADMIN_ROLE_CODES)
  for (const role of roles) {
    if (adminRoleCodes.has(stringValue(role))) return true
  }
  return false
}

export function scopedGrantsNeedAltocDepartmentTree(grants: FoundationScopedAuthorizationGrant[]) {
  return grants.some(grant => [
    ...(grant.defaultScopes || []),
    ...(grant.assignmentScopes || []),
    ...(grant.scopes || [])
  ].some(scope => (
    stringValue(scope.dimension) === 'department'
      && stringValue(scope.predicate) === 'tree'
      && Boolean(stringValue(scope.value))
  )))
}

function actionMatches(granted: string, required: string, policy?: ResourceActionPolicy) {
  return authorizationActionsAllow([granted], required, policy)
}

function permissionMatches(
  permission: { appCode: string, resourceCode: string, action: string },
  appCode: string,
  resource: string,
  action: string,
  policy?: ResourceActionPolicy
) {
  return permission.appCode === appCode
    && permission.resourceCode === resource
    && actionMatches(permission.action, action, policy)
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

function departmentScopeCodes(
  scope: FoundationScopePredicate,
  departmentTreeCodesByRoot: AltocDepartmentTreeCodeIndex = {}
) {
  if (stringValue(scope.dimension) !== 'department') return []

  const predicate = stringValue(scope.predicate)
  const value = stringValue(scope.value)
  if (predicate === 'self') return value ? [value] : []
  if (predicate === 'tree') return value ? uniqueStrings([value, ...(departmentTreeCodesByRoot[value] || [])]) : []
  return []
}

function isDepartmentScope(scope: FoundationScopePredicate) {
  const predicate = stringValue(scope.predicate)
  return stringValue(scope.dimension) === 'department'
    && (predicate === 'self' || predicate === 'tree')
}

function isOwnerOrDepartmentScope(scope: FoundationScopePredicate) {
  return isOwnerScope(scope) || isDepartmentScope(scope)
}

function intersectDeptCodes(left: string[], right: string[]) {
  if (!left.length) return uniqueStrings(right)
  const rightSet = new Set(right)
  return left.filter(item => rightSet.has(item))
}

function scopedGroupResult(
  scopes: FoundationScopePredicate[],
  currentDeptCodes: string[],
  departmentTreeCodesByRoot: AltocDepartmentTreeCodeIndex = {}
): AltocScopeResult {
  const sawOwnerScope = scopes.some(isOwnerScope)
  const sawDeptScope = scopes.some(isDepartmentScope)
  const departmentTreeWithoutValue = scopes.some(scope => (
    stringValue(scope.dimension) === 'department'
    && stringValue(scope.predicate) === 'tree'
    && !stringValue(scope.value)
  ))

  if (scopes.length === 0) return { access: 'all', deptCodes: [] }
  if (scopes.every(isOwnerScope)) return { access: 'self', deptCodes: [] }

  if (scopes.every(isDepartmentScope) && !departmentTreeWithoutValue) {
    const departmentSelfWithoutValue = scopes.some(scope => (
      stringValue(scope.dimension) === 'department'
      && stringValue(scope.predicate) === 'self'
      && !stringValue(scope.value)
    ))
    const deptCodes = uniqueStrings([
      ...scopes.flatMap(scope => departmentScopeCodes(scope, departmentTreeCodesByRoot)),
      ...(departmentSelfWithoutValue ? currentDeptCodes : [])
    ])
    return deptCodes.length > 0 ? { access: 'dept', deptCodes } : { access: 'none', deptCodes: [] }
  }

  if (sawOwnerScope && sawDeptScope && scopes.every(isOwnerOrDepartmentScope) && !departmentTreeWithoutValue) {
    const departmentSelfWithoutValue = scopes.some(scope => (
      stringValue(scope.dimension) === 'department'
      && stringValue(scope.predicate) === 'self'
      && !stringValue(scope.value)
    ))
    const deptCodes = uniqueStrings([
      ...scopes.flatMap(scope => departmentScopeCodes(scope, departmentTreeCodesByRoot)),
      ...(departmentSelfWithoutValue ? currentDeptCodes : [])
    ])
    return deptCodes.length > 0 ? { access: 'self_dept', deptCodes } : { access: 'none', deptCodes: [] }
  }

  return { access: 'none', deptCodes: [] }
}

function intersectScopeResults(left: AltocScopeResult, right: AltocScopeResult): AltocScopeResult {
  if (left.access === 'none' || right.access === 'none') return { access: 'none', deptCodes: [] }
  if (left.access === 'all') return right
  if (right.access === 'all') return left
  if (left.access === 'self' && right.access === 'self') return { access: 'self', deptCodes: [] }
  if (left.access === 'dept' && right.access === 'dept') {
    const deptCodes = intersectDeptCodes(left.deptCodes, right.deptCodes)
    return deptCodes.length > 0 ? { access: 'dept', deptCodes } : { access: 'none', deptCodes: [] }
  }
  if (left.access === 'self' && right.access === 'dept') return right.deptCodes.length > 0 ? { access: 'self_dept', deptCodes: right.deptCodes } : { access: 'none', deptCodes: [] }
  if (left.access === 'dept' && right.access === 'self') return left.deptCodes.length > 0 ? { access: 'self_dept', deptCodes: left.deptCodes } : { access: 'none', deptCodes: [] }
  if (left.access === 'self_dept' && right.access === 'self') return left
  if (left.access === 'self' && right.access === 'self_dept') return right
  if (left.access === 'self_dept' && right.access === 'dept') {
    const deptCodes = intersectDeptCodes(left.deptCodes, right.deptCodes)
    return deptCodes.length > 0 ? { access: 'self_dept', deptCodes } : { access: 'none', deptCodes: [] }
  }
  if (left.access === 'dept' && right.access === 'self_dept') {
    const deptCodes = intersectDeptCodes(left.deptCodes, right.deptCodes)
    return deptCodes.length > 0 ? { access: 'self_dept', deptCodes } : { access: 'none', deptCodes: [] }
  }
  if (left.access === 'self_dept' && right.access === 'self_dept') {
    const deptCodes = intersectDeptCodes(left.deptCodes, right.deptCodes)
    return deptCodes.length > 0 ? { access: 'self_dept', deptCodes } : { access: 'none', deptCodes: [] }
  }
  return { access: 'none', deptCodes: [] }
}

function grantScopeResult(
  grant: FoundationScopedAuthorizationGrant,
  currentDeptCodes: string[],
  departmentTreeCodesByRoot: AltocDepartmentTreeCodeIndex = {}
): AltocScopeResult {
  const scopeGroups = [
    grant.defaultScopes || [],
    grant.assignmentScopes || [],
    grant.scopes || []
  ]
    .map(scopes => scopes.filter(scope => !isTenantGlobalScope(scope)))
    .filter(scopes => scopes.length > 0)

  if (scopeGroups.length === 0) return { access: 'all', deptCodes: [] }

  let result: AltocScopeResult = { access: 'all', deptCodes: [] }
  for (const scopes of scopeGroups) {
    result = intersectScopeResults(
      result,
      scopedGroupResult(scopes, currentDeptCodes, departmentTreeCodesByRoot)
    )
    if (result.access === 'none') return result
  }

  return result
}

function accessQuery(result: AltocScopeResult): RuntimeQuery {
  const query: RuntimeQuery = {
    current_user_altoc_access: result.access,
    current_user_data_access: result.access
  }
  if ((result.access === 'dept' || result.access === 'self_dept') && result.deptCodes.length > 0) {
    const joined = result.deptCodes.join(',')
    query.current_user_altoc_dept_codes = joined
    query.current_user_data_dept_codes = joined
  }
  return query
}

function finalizeAltocScopedDataAccess(input: { allowSelf: boolean, deptCodes: string[] }) {
  const deptCodes = uniqueStrings(input.deptCodes)
  if (deptCodes.length > 0) return { access: 'dept' as const, deptCodes }
  if (input.allowSelf) return { access: 'self' as const, deptCodes: [] }
  return { access: 'none' as const, deptCodes: [] }
}

export function resolveAltocDataAccessQueryFromScopedGrants(input: ResolveAltocDataAccessFromGrantsInput): RuntimeQuery {
  if (input.hasGlobalAdminRole) {
    return accessQuery({ access: 'all', deptCodes: [] })
  }

  let allowSelf = false
  const allowedDeptCodes: string[] = []
  const allowedSelfDeptCodes: string[] = []

  for (const grant of input.grants) {
    if (!grant.permissions.some(permission => permissionMatches(
      permission,
      input.appCode,
      input.resource,
      input.action,
      input.actionPolicy
    ))) continue

    const result = grantScopeResult(grant, input.currentDeptCodes, input.departmentTreeCodesByRoot)
    if (result.access === 'all') return accessQuery(result)
    if (result.access === 'self') allowSelf = true
    if (result.access === 'dept') allowedDeptCodes.push(...result.deptCodes)
    if (result.access === 'self_dept') allowedSelfDeptCodes.push(...result.deptCodes)
  }

  const broadResult = finalizeAltocScopedDataAccess({ allowSelf, deptCodes: allowedDeptCodes })
  if (broadResult.access !== 'none') return accessQuery(broadResult)

  const selfDeptCodes = uniqueStrings(allowedSelfDeptCodes)
  if (selfDeptCodes.length > 0) return accessQuery({ access: 'self_dept', deptCodes: selfDeptCodes })
  return accessQuery({ access: 'none', deptCodes: [] })
}
