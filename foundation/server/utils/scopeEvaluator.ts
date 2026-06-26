import { actionSatisfies } from '@hzy/authz-core'

export interface FoundationScopePredicate {
  dimension: string
  predicate: string
  value?: string | null
  group?: string
  source?: 'role_default' | 'assignment' | 'relation' | 'baseline' | string
}

export interface FoundationObjectContext {
  actorUid?: string | null
  ownerUid?: string | null
  departmentCode?: string | null
  departmentTree?: string[]
  projectCode?: string | null
  projectOwnerUid?: string | null
  projectMemberUids?: string[]
  customerOwnerUid?: string | null
  customerTeamUids?: string[]
  assignedUid?: string | null
  assignedUids?: string[]
  environment?: string | null
  deploymentEnvironment?: string | null
  matchedRelations?: string[]
  [key: string]: unknown
}

export interface FoundationPermissionTriple {
  appCode: string
  resourceCode: string
  action: string
}

export interface FoundationScopedAuthorizationGrant {
  grantId: string
  permissions: FoundationPermissionTriple[]
  scopes?: FoundationScopePredicate[]
  defaultScopes?: FoundationScopePredicate[]
  assignmentScopes?: FoundationScopePredicate[]
}

export interface FoundationScopedAuthorizationRequirement {
  appCode: string
  resourceCode: string
  action: string
}

export interface FoundationScopedAuthorizationInput {
  grants: FoundationScopedAuthorizationGrant[]
  required: FoundationScopedAuthorizationRequirement
  object?: FoundationObjectContext
}

export interface FoundationScopedAuthorizationDecision {
  allowed: boolean
  reasonCode: 'allowed' | 'no_permission' | 'scope_not_matched'
  matchedGrantId?: string
  matchedScopes?: FoundationScopePredicate[]
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => stringValue(item)).filter(Boolean)
    : []
}

function sameValue(left: unknown, right: unknown) {
  const leftValue = stringValue(left)
  const rightValue = stringValue(right)
  return !!leftValue && !!rightValue && leftValue === rightValue
}

function valueMatchesOptionalScope(scopeValue: unknown, objectValue: unknown) {
  const expected = stringValue(scopeValue)
  return !expected || sameValue(expected, objectValue)
}

function relationMatches(predicate: string, object?: FoundationObjectContext) {
  const relations = new Set(stringList(object?.matchedRelations))
  return relations.has(predicate) || relations.has(`relation:${predicate}`)
}

export function foundationScopePredicateMatches(
  scope: FoundationScopePredicate,
  object?: FoundationObjectContext
): boolean {
  const dimension = stringValue(scope.dimension)
  const predicate = stringValue(scope.predicate)

  if (dimension === 'tenant' && predicate === 'global') {
    return true
  }
  if (!object) {
    return false
  }

  const actorUid = stringValue(object.actorUid)

  if (dimension === 'subject' && predicate === 'self') {
    return !!actorUid && sameValue(actorUid, object.ownerUid)
  }

  if (dimension === 'department') {
    if (predicate === 'self') {
      return valueMatchesOptionalScope(scope.value, object.departmentCode)
    }
    if (predicate === 'tree') {
      const expected = stringValue(scope.value)
      const departmentTree = new Set(stringList(object.departmentTree))
      return !expected || departmentTree.has(expected) || sameValue(expected, object.departmentCode)
    }
  }

  if (dimension === 'project') {
    if (predicate === 'member') {
      const projectMatches = valueMatchesOptionalScope(scope.value, object.projectCode)
      if (!projectMatches) return false
      const memberUids = stringList(object.projectMemberUids)
      return !memberUids.length || (!!actorUid && memberUids.includes(actorUid))
    }
    if (predicate === 'owner') {
      return valueMatchesOptionalScope(scope.value, object.projectCode)
        && !!actorUid
        && sameValue(actorUid, object.projectOwnerUid ?? object.ownerUid)
    }
  }

  if (dimension === 'customer') {
    if (predicate === 'owner') {
      return !!actorUid && sameValue(actorUid, object.customerOwnerUid ?? object.ownerUid)
    }
    if (predicate === 'team') {
      return !!actorUid && stringList(object.customerTeamUids).includes(actorUid)
    }
  }

  if (dimension === 'object' && predicate === 'assigned') {
    const assignedUids = stringList(object.assignedUids)
    return !!actorUid && (
      assignedUids.includes(actorUid)
      || sameValue(actorUid, object.assignedUid)
    )
  }

  if (dimension === 'relation') {
    return relationMatches(predicate, object)
  }

  if (dimension === 'environment') {
    return predicate === stringValue(object.environment)
      || predicate === stringValue(object.deploymentEnvironment)
  }

  return scope.value != null && sameValue(object[dimension], scope.value)
}

export function foundationScopeSetMatches(
  scopes: FoundationScopePredicate[] = [],
  object?: FoundationObjectContext
) {
  if (!scopes.length) return true

  const scopesByDimension = new Map<string, FoundationScopePredicate[]>()
  for (const scope of scopes) {
    const dimension = stringValue(scope.dimension)
    if (!dimension) continue
    const items = scopesByDimension.get(dimension) || []
    items.push(scope)
    scopesByDimension.set(dimension, items)
  }

  for (const dimensionScopes of scopesByDimension.values()) {
    if (!dimensionScopes.some(scope => foundationScopePredicateMatches(scope, object))) {
      return false
    }
  }
  return true
}

export function foundationGrantScopeMatches(
  grant: Pick<FoundationScopedAuthorizationGrant, 'scopes' | 'defaultScopes' | 'assignmentScopes'>,
  object?: FoundationObjectContext
) {
  return foundationScopeSetMatches(grant.defaultScopes || [], object)
    && foundationScopeSetMatches(grant.assignmentScopes || [], object)
    && foundationScopeSetMatches(grant.scopes || [], object)
}

function permissionMatches(permission: FoundationPermissionTriple, required: FoundationScopedAuthorizationRequirement) {
  return permission.appCode === required.appCode
    && permission.resourceCode === required.resourceCode
    && actionSatisfies(permission.action, required.action)
}

export function evaluateFoundationScopedAuthorization(
  input: FoundationScopedAuthorizationInput
): FoundationScopedAuthorizationDecision {
  let sawPermissionMatch = false

  for (const grant of input.grants) {
    if (!grant.permissions.some(permission => permissionMatches(permission, input.required))) {
      continue
    }

    sawPermissionMatch = true
    if (!foundationGrantScopeMatches(grant, input.object)) {
      continue
    }

    return {
      allowed: true,
      reasonCode: 'allowed',
      matchedGrantId: grant.grantId,
      matchedScopes: [
        ...(grant.defaultScopes || []),
        ...(grant.assignmentScopes || []),
        ...(grant.scopes || [])
      ]
    }
  }

  return {
    allowed: false,
    reasonCode: sawPermissionMatch ? 'scope_not_matched' : 'no_permission'
  }
}
