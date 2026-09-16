import { authorizationActionsAllow, type ResourceActionPolicy } from '@hzy/foundation/shared/utils/authorizationActions'

export type AssetsObjectAccess = 'all' | 'relation' | 'none'
export type AssetsScopedAction = 'view' | 'request' | 'edit' | 'approve' | 'admin'

interface ScopePredicate { dimension?: unknown, predicate?: unknown, value?: unknown }
interface ScopedGrant {
  permissions: Array<{ appCode: string, resourceCode: string, action: string }>
  defaultScopes?: ScopePredicate[]
  assignmentScopes?: ScopePredicate[]
  scopes?: ScopePredicate[]
}
interface ScopedSnapshot { grants: ScopedGrant[], actionPolicy?: ResourceActionPolicy }

export interface AssetsScopeUnit {
  directRelation: boolean
  relationPredicates: string[]
  departmentCodes: string[]
  projectCodes: string[]
}
export interface AssetsObjectScope {
  access: AssetsObjectAccess
  units: AssetsScopeUnit[]
}
export type AssetsDepartmentTreeCodeIndex = Record<string, string[]>

const trustedObjectAccessKeys = new Set([
  'current_user_assets_object_access', 'currentUserAssetsObjectAccess',
  'current_user_assets_scope_units', 'currentUserAssetsScopeUnits',
  'current_user_assets_permission_action', 'currentUserAssetsPermissionAction'
])

const text = (value: unknown) => String(value || '').trim()
const unique = (values: string[]) => Array.from(new Set(values.map(text).filter(Boolean)))
const intersect = (left: string[], right: string[]) => {
  if (!left.length) return unique(right)
  const allowed = new Set(right)
  return left.filter(value => allowed.has(value))
}
const isTenantGlobal = (scope: ScopePredicate) => text(scope.dimension) === 'tenant' && text(scope.predicate) === 'global'
const directPredicate = (scope: ScopePredicate) => {
  const dimension = text(scope.dimension)
  const predicate = text(scope.predicate)
  if (dimension === 'subject' && predicate === 'self') return 'self'
  if (dimension === 'object' && predicate === 'assigned') return 'assigned'
  if (dimension !== 'asset') return ''
  if (predicate === 'keeper') return 'custodian'
  return ['owner', 'custodian', 'user', 'assigned'].includes(predicate) ? predicate : ''
}
const isDirect = (scope: ScopePredicate) => Boolean(directPredicate(scope))

function permissionMatches(grant: ScopedGrant, resourceCode: string, action: AssetsScopedAction, policy?: ResourceActionPolicy) {
  return grant.permissions.some(permission => permission.appCode === 'assets'
    && permission.resourceCode === resourceCode
    && authorizationActionsAllow([permission.action], action, policy))
}
function hasExplicitAdmin(grant: ScopedGrant, resourceCode: string) {
  return grant.permissions.some(permission => permission.appCode === 'assets'
    && permission.resourceCode === resourceCode && permission.action === 'admin')
}

function groupUnit(
  scopes: ScopePredicate[],
  currentDeptCodes: string[],
  departmentTreeCodesByRoot: AssetsDepartmentTreeCodeIndex
): AssetsScopeUnit | null {
  const nonGlobal = scopes.filter(scope => !isTenantGlobal(scope))
  if (!nonGlobal.length) return { directRelation: false, relationPredicates: [], departmentCodes: [], projectCodes: [] }
  if (nonGlobal.some(scope => !isDirect(scope) && !['department', 'project'].includes(text(scope.dimension)))) return null

  const directRelation = nonGlobal.some(isDirect)
  const relationPredicates = unique(nonGlobal.map(directPredicate))
  const departmentScopes = nonGlobal.filter(scope => text(scope.dimension) === 'department')
  const projectScopes = nonGlobal.filter(scope => text(scope.dimension) === 'project')
  const departmentCodes = unique(departmentScopes.flatMap((scope) => {
    const predicate = text(scope.predicate)
    const value = text(scope.value)
    if (predicate === 'self') return value ? [value] : currentDeptCodes
    if (predicate === 'tree' && value) return unique([value, ...(departmentTreeCodesByRoot[value] || [])])
    return []
  }))
  const projectCodes = unique(projectScopes.flatMap((scope) => {
    const predicate = text(scope.predicate)
    const value = text(scope.value)
    return predicate === 'code' && value ? [value] : []
  }))
  if ((departmentScopes.length && !departmentCodes.length) || (projectScopes.length && !projectCodes.length)) return null
  return { directRelation, relationPredicates, departmentCodes, projectCodes }
}

function grantUnit(
  grant: ScopedGrant,
  currentDeptCodes: string[],
  departmentTreeCodesByRoot: AssetsDepartmentTreeCodeIndex
): AssetsScopeUnit | 'all' | null {
  const groups = [grant.defaultScopes || [], grant.assignmentScopes || [], grant.scopes || []]
    .map(scopes => scopes.filter(scope => !isTenantGlobal(scope)))
    .filter(scopes => scopes.length)
  if (!groups.length) return 'all'
  const result: AssetsScopeUnit = { directRelation: false, relationPredicates: [], departmentCodes: [], projectCodes: [] }
  let sawDepartment = false
  let sawProject = false
  for (const scopes of groups) {
    const unit = groupUnit(scopes, currentDeptCodes, departmentTreeCodesByRoot)
    if (!unit) return null
    result.directRelation = result.directRelation || unit.directRelation
    result.relationPredicates = unique([...result.relationPredicates, ...unit.relationPredicates])
    if (unit.departmentCodes.length) {
      result.departmentCodes = sawDepartment ? intersect(result.departmentCodes, unit.departmentCodes) : unit.departmentCodes
      sawDepartment = true
      if (!result.departmentCodes.length) return null
    }
    if (unit.projectCodes.length) {
      result.projectCodes = sawProject ? intersect(result.projectCodes, unit.projectCodes) : unit.projectCodes
      sawProject = true
      if (!result.projectCodes.length) return null
    }
  }
  return result.directRelation || result.departmentCodes.length || result.projectCodes.length ? result : null
}

export function assetsObjectScopeFromScopedAuthorization(
  scoped: ScopedSnapshot,
  resourceCode: string,
  action: AssetsScopedAction,
  currentDeptCodes: string[] = [],
  departmentTreeCodesByRoot: AssetsDepartmentTreeCodeIndex = {}
): AssetsObjectScope {
  const units: AssetsScopeUnit[] = []
  for (const grant of scoped.grants) {
    if (!permissionMatches(grant, resourceCode, action, scoped.actionPolicy)) continue
    if (hasExplicitAdmin(grant, resourceCode)) return { access: 'all', units: [] }
    const unit = grantUnit(grant, currentDeptCodes, departmentTreeCodesByRoot)
    if (unit === 'all') return { access: 'all', units: [] }
    if (unit) units.push(unit)
  }
  return units.length ? { access: 'relation', units } : { access: 'none', units: [] }
}

export function assetsObjectAccessFromScopedAuthorization(scoped: ScopedSnapshot, resourceCode: string, action: AssetsScopedAction) {
  return assetsObjectScopeFromScopedAuthorization(scoped, resourceCode, action).access
}

export function assetsObjectScopeQuery(scope: AssetsObjectScope) {
  return {
    current_user_assets_object_access: scope.access,
    ...(scope.units.length ? { current_user_assets_scope_units: JSON.stringify(scope.units) } : {})
  }
}

export function sanitizeAssetsObjectAccessRecord(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !trustedObjectAccessKeys.has(key)))
}
