import { actionSatisfies, type ResourceActionPolicy } from '@hzy/authz-core'

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
  productCode?: string | null
  productMemberUids?: string[]
  productManagerUids?: string[]
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
  policyOf?: (appCode: string, resourceCode: string) => ResourceActionPolicy | undefined
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
    if (predicate === 'code') {
      return sameValue(scope.value, object.projectCode)
    }
    if (predicate === 'member') {
      const projectMatches = valueMatchesOptionalScope(scope.value, object.projectCode)
      if (!projectMatches) return false
      const memberUids = stringList(object.projectMemberUids)
      return !!actorUid && memberUids.includes(actorUid)
    }
    if (predicate === 'owner') {
      return valueMatchesOptionalScope(scope.value, object.projectCode)
        && !!actorUid
        && sameValue(actorUid, object.projectOwnerUid ?? object.ownerUid)
    }
  }

  if (dimension === 'product') {
    // Product relations come from the AIMS workspace, never Assets ownership
    // or project membership. Unknown product predicates must fail closed.
    if (predicate === 'code') return sameValue(scope.value, object.productCode)
    if (!stringValue(object.productCode)
      || !valueMatchesOptionalScope(scope.value, object.productCode)
      || !actorUid) return false
    if (predicate === 'member') return stringList(object.productMemberUids).includes(actorUid)
    if (predicate === 'manager') return stringList(object.productManagerUids).includes(actorUid)
    return false
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

function permissionMatches(
  permission: FoundationPermissionTriple,
  required: FoundationScopedAuthorizationRequirement,
  policy?: ResourceActionPolicy
) {
  return permission.appCode === required.appCode
    && permission.resourceCode === required.resourceCode
    && actionSatisfies(permission.action, required.action, policy)
}

export function evaluateFoundationScopedAuthorization(
  input: FoundationScopedAuthorizationInput
): FoundationScopedAuthorizationDecision {
  let sawPermissionMatch = false
  const policy = input.policyOf?.(input.required.appCode, input.required.resourceCode)

  for (const grant of input.grants) {
    if (!grant.permissions.some(permission => permissionMatches(permission, input.required, policy))) {
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

// Product workspaces only define product relationships and tenant scope. Other
// dimensions have no product-domain fact and cannot broaden access via an empty
// project/department context. Keep this rule shared by detail and list decisions.
export function evaluateFoundationProductAuthorization(input: FoundationScopedAuthorizationInput): FoundationScopedAuthorizationDecision {
  const grants = input.grants.filter(grant => [
    ...(grant.defaultScopes || []), ...(grant.assignmentScopes || []), ...(grant.scopes || [])
  ].every(scope => (scope.dimension === 'tenant' && scope.predicate === 'global')
    || (scope.dimension === 'product' && ['code', 'member', 'manager'].includes(scope.predicate))
    || (scope.dimension === 'relation' && ['product:member', 'product:manager', 'product_member', 'product_manager', 'relation:product_member', 'relation:product_manager'].includes(scope.predicate))))
  return evaluateFoundationScopedAuthorization({ ...input, grants })
}

export interface FoundationProductScopeProjection {
  default_mask: number
  overrides: Array<{ product_code: string, mask: number }>
}

// Evaluate the finite product fact domain with the existing grant evaluator.
// Bits: 1=non-member, 2=member, 4=manager. Runtime only selects the current
// relationship state; it never interprets roles, policies or grant merging.
export function compileFoundationProductScope(input: Omit<FoundationScopedAuthorizationInput, 'object'>, actorUid: string): FoundationProductScopeProjection | null {
  // Unrelated actions must not consume the product-code projection bound.
  const grants = input.grants.filter(grant => evaluateFoundationScopedAuthorization({
    ...input, grants: [{ ...grant, defaultScopes: [], assignmentScopes: [], scopes: [] }]
  }).allowed)
  input = { ...input, grants }
  const codes = new Set<string>()
  for (const grant of input.grants) {
    for (const scope of [...(grant.defaultScopes || []), ...(grant.assignmentScopes || []), ...(grant.scopes || [])]) {
      if (scope.dimension === 'product' && stringValue(scope.value)) codes.add(stringValue(scope.value))
    }
  }
  if (!actorUid || codes.size > 512 || [...codes].some(code => [...code].length > 64)) return null
  let other = '\u0000other-product'
  while (codes.has(other)) other += '\u0000'
  const maskFor = (productCode: string) => {
    let mask = 0
    for (let state = 0; state < 3; state++) {
      const object: FoundationObjectContext = {
        actorUid, productCode,
        productMemberUids: state > 0 ? [actorUid] : [],
        productManagerUids: state === 2 ? [actorUid] : [],
        matchedRelations: [
          ...(state > 0 ? ['product:member', 'relation:product_member'] : []),
          ...(state === 2 ? ['product:manager', 'relation:product_manager'] : [])
        ]
      }
      if (evaluateFoundationProductAuthorization({ ...input, object }).allowed) mask |= 1 << state
    }
    return mask
  }
  const default_mask = maskFor(other)
  return { default_mask, overrides: [...codes].sort().map(product_code => ({ product_code, mask: maskFor(product_code) })).filter(row => row.mask !== default_mask) }
}
