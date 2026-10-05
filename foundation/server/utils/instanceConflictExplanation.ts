import { actionSatisfies, type PermissionTriple, type ResourceActionPolicy } from '@hzy/authz-core'
import { buildPolicyBundleActionPolicy } from './applicationAuthorization'
import {
  evaluateFoundationScopedAuthorization,
  type FoundationObjectContext,
  type FoundationScopedAuthorizationDecision,
  type FoundationScopedAuthorizationGrant
} from './scopeEvaluator'

type BundleRecord = Record<string, unknown>
type ConflictEnforcement = 'warning' | 'enforce'

export interface FoundationInstancePrincipalInput {
  kind: string
  uid?: string | null
}

export interface FoundationInstanceConflictPrincipal {
  kind: string
  uid: string
  matchesActor: boolean
}

export interface FoundationInstanceConflictSideExplanation {
  permission: PermissionTriple
  allowed: boolean
  reasonCode: string
  matchedAction: string | null
  matchedGrant: FoundationScopedAuthorizationGrant | null
}

export interface FoundationInstanceConflictRuleExplanation {
  ruleCode: string
  ruleName: string
  conflictType: string
  enforcement: ConflictEnforcement
  description: string
  requestedSide: 'left' | 'right'
  approvalLike: boolean
  sameActorPrincipals: FoundationInstanceConflictPrincipal[]
  status: 'violated' | 'satisfied' | 'not_applicable'
  reasonCode:
    | 'self_approval'
    | 'different_instance_actor'
    | 'missing_requested_permission'
    | 'missing_counterpart_permission'
    | 'non_approval_side'
  message: string
  requested: FoundationInstanceConflictSideExplanation
  counterpart: FoundationInstanceConflictSideExplanation
}

export interface FoundationInstanceConflictExplainResult {
  tenantCode: string
  uid: string
  requested: PermissionTriple
  principals: FoundationInstanceConflictPrincipal[]
  hasViolation: boolean
  hasBlockingViolation: boolean
  hasWarningViolation: boolean
  rules: FoundationInstanceConflictRuleExplanation[]
}

export interface FoundationInstanceConflictExplainInput {
  tenantCode: string
  uid: string
  appCode: string
  resourceCode: string
  action: string
  payload: Record<string, unknown> | null | undefined
  grants: FoundationScopedAuthorizationGrant[]
  object?: FoundationObjectContext | null
  principals?: FoundationInstancePrincipalInput[]
}

interface NormalizedConflictRule {
  ruleCode: string
  ruleName: string
  conflictType: string
  enforcement: ConflictEnforcement
  left: PermissionTriple | null
  right: PermissionTriple | null
  description: string
}

const APPROVAL_LIKE_ACTIONS = new Set([
  'approve',
  'reject',
  'confirm',
  'close',
  'archive',
  'pay',
  'reconcile',
  'deploy',
  'review-approve',
  'review-reject'
])

function stringValue(value: unknown) {
  return String(value ?? '').trim()
}

function records(value: unknown): BundleRecord[] {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as BundleRecord[]
    : []
}

function normalizedStatus(value: unknown) {
  return stringValue(value) || 'active'
}

function permissionFromRuleSide(rule: BundleRecord, side: 'left' | 'right'): PermissionTriple | null {
  const appCode = stringValue(rule[`${side}AppCode`])
  const resourceCode = stringValue(rule[`${side}ResourceCode`])
  const action = stringValue(rule[`${side}Action`])
  return appCode && resourceCode && action
    ? { appCode, resourceCode, action }
    : null
}

function normalizeEnforcement(value: unknown): ConflictEnforcement {
  return stringValue(value) === 'enforce' ? 'enforce' : 'warning'
}

function normalizeRule(rule: BundleRecord): NormalizedConflictRule | null {
  const ruleCode = stringValue(rule.ruleCode)
  const left = permissionFromRuleSide(rule, 'left')
  const right = permissionFromRuleSide(rule, 'right')
  if (!ruleCode || !left || !right || normalizedStatus(rule.status) !== 'active') return null

  return {
    ruleCode,
    ruleName: stringValue(rule.ruleName) || ruleCode,
    conflictType: stringValue(rule.conflictType) || 'segregation_of_duties',
    enforcement: normalizeEnforcement(rule.enforcement),
    left,
    right,
    description: stringValue(rule.description) || stringValue(rule.ruleName) || ruleCode
  }
}

function normalizePrincipal(input: FoundationInstancePrincipalInput, actorUid: string): FoundationInstanceConflictPrincipal | null {
  const kind = stringValue(input.kind)
  const uid = stringValue(input.uid)
  if (!kind || !uid) return null

  return {
    kind,
    uid,
    matchesActor: uid === actorUid
  }
}

function permissionMatchesRuleSide(
  rulePermission: PermissionTriple | null | undefined,
  requested: PermissionTriple,
  policy?: ResourceActionPolicy
) {
  if (!rulePermission) return false
  return rulePermission.appCode === requested.appCode
    && rulePermission.resourceCode === requested.resourceCode
    && actionSatisfies(rulePermission.action, requested.action, policy)
}

function isApprovalLike(permission: PermissionTriple) {
  return APPROVAL_LIKE_ACTIONS.has(permission.action)
}

function matchedGrant(
  decision: FoundationScopedAuthorizationDecision,
  grants: FoundationScopedAuthorizationGrant[],
  required: PermissionTriple,
  policy?: ResourceActionPolicy
) {
  if (!decision.matchedGrantId) return null
  const grant = grants.find(item => item.grantId === decision.matchedGrantId) || null
  if (!grant) return null
  return grant.permissions.some(permission =>
    permission.appCode === required.appCode
    && permission.resourceCode === required.resourceCode
    && actionSatisfies(permission.action, required.action, policy)
  )
    ? grant
    : null
}

function matchedAction(
  grant: FoundationScopedAuthorizationGrant | null,
  required: PermissionTriple,
  policy?: ResourceActionPolicy
) {
  const permission = grant?.permissions.find(item =>
    item.appCode === required.appCode
    && item.resourceCode === required.resourceCode
    && actionSatisfies(item.action, required.action, policy)
  )
  return permission?.action || null
}

function explainPermission(input: {
  grants: FoundationScopedAuthorizationGrant[]
  required: PermissionTriple
  object?: FoundationObjectContext | null
  policy?: ResourceActionPolicy
}) {
  const decision = evaluateFoundationScopedAuthorization({
    grants: input.grants,
    required: input.required,
    object: input.object || undefined,
    policyOf: input.policy ? () => input.policy : undefined
  })
  const grant = matchedGrant(decision, input.grants, input.required, input.policy)
  return {
    permission: input.required,
    allowed: decision.allowed,
    reasonCode: decision.reasonCode,
    matchedAction: matchedAction(grant, input.required, input.policy),
    matchedGrant: grant
  }
}

function ruleMessage(input: {
  rule: NormalizedConflictRule
  status: FoundationInstanceConflictRuleExplanation['status']
  sameActorPrincipals: FoundationInstanceConflictPrincipal[]
}) {
  if (input.status === 'violated') {
    const labels = input.sameActorPrincipals.map(item => item.kind).join(', ')
    return `触发“${input.rule.ruleName}”：当前用户同时是业务实例的 ${labels}，应由另一名授权人完成该动作。`
  }
  if (input.status === 'satisfied') {
    return `未触发“${input.rule.ruleName}”：当前用户不是该业务实例的发起/经办主体。`
  }
  return `未适用“${input.rule.ruleName}”。`
}

export function explainPolicyBundleInstanceConflicts(
  input: FoundationInstanceConflictExplainInput
): FoundationInstanceConflictExplainResult {
  const uid = stringValue(input.uid)
  const requested: PermissionTriple = {
    appCode: stringValue(input.appCode),
    resourceCode: stringValue(input.resourceCode),
    action: stringValue(input.action)
  }
  const payload = input.payload || {}
  const principals = (input.principals || [])
    .map(principal => normalizePrincipal(principal, uid))
    .filter((principal): principal is FoundationInstanceConflictPrincipal => Boolean(principal))
  const sameActorPrincipals = principals.filter(principal => principal.matchesActor)
  const rules = records(payload.conflictRules)
    .map(rule => normalizeRule(rule))
    .filter((rule): rule is NormalizedConflictRule => Boolean(rule))
  const requestedPolicy = buildPolicyBundleActionPolicy(payload, requested.appCode, requested.resourceCode)
  const requestedExplain = explainPermission({
    grants: input.grants,
    required: requested,
    object: input.object,
    policy: requestedPolicy
  })
  const explanations: FoundationInstanceConflictRuleExplanation[] = []

  for (const rule of rules) {
    const leftPolicy = rule.left ? buildPolicyBundleActionPolicy(payload, rule.left.appCode, rule.left.resourceCode) : undefined
    const rightPolicy = rule.right ? buildPolicyBundleActionPolicy(payload, rule.right.appCode, rule.right.resourceCode) : undefined
    const leftMatches = permissionMatchesRuleSide(rule.left, requested, leftPolicy)
    const rightMatches = permissionMatchesRuleSide(rule.right, requested, rightPolicy)
    if (!leftMatches && !rightMatches) continue

    const requestedSide = rightMatches ? 'right' : 'left'
    const counterpartPermission = requestedSide === 'right' ? rule.left : rule.right
    if (!counterpartPermission) continue

    const counterpartPolicy = buildPolicyBundleActionPolicy(payload, counterpartPermission.appCode, counterpartPermission.resourceCode)
    const counterpartExplain = explainPermission({
      grants: input.grants,
      required: counterpartPermission,
      object: input.object,
      policy: counterpartPolicy
    })
    const approvalLike = isApprovalLike(requested)
    let status: FoundationInstanceConflictRuleExplanation['status'] = 'not_applicable'
    let reasonCode: FoundationInstanceConflictRuleExplanation['reasonCode'] = 'non_approval_side'

    if (!approvalLike || requestedSide !== 'right') {
      status = 'not_applicable'
      reasonCode = 'non_approval_side'
    } else if (!requestedExplain.allowed) {
      status = 'not_applicable'
      reasonCode = 'missing_requested_permission'
    } else if (!counterpartExplain.allowed) {
      status = 'not_applicable'
      reasonCode = 'missing_counterpart_permission'
    } else if (sameActorPrincipals.length > 0) {
      status = 'violated'
      reasonCode = 'self_approval'
    } else {
      status = 'satisfied'
      reasonCode = 'different_instance_actor'
    }

    explanations.push({
      ruleCode: rule.ruleCode,
      ruleName: rule.ruleName,
      conflictType: rule.conflictType,
      enforcement: rule.enforcement,
      description: rule.description,
      requestedSide,
      approvalLike,
      sameActorPrincipals,
      status,
      reasonCode,
      message: ruleMessage({ rule, status, sameActorPrincipals }),
      requested: requestedExplain,
      counterpart: counterpartExplain
    })
  }

  const violations = explanations.filter(rule => rule.status === 'violated')
  return {
    tenantCode: stringValue(input.tenantCode),
    uid,
    requested,
    principals,
    hasViolation: violations.length > 0,
    hasBlockingViolation: violations.some(rule => rule.enforcement === 'enforce'),
    hasWarningViolation: violations.some(rule => rule.enforcement === 'warning'),
    rules: explanations
  }
}
