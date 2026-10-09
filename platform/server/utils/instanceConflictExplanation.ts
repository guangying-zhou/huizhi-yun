import { actionSatisfies, type PermissionTriple } from '@hzy/authz-core'
import type { RowDataPacket } from 'mysql2/promise'
import {
  explainDbAuthorizationWithQueries,
  type AuthorizationGrantQueryAdapter,
  type DbAuthorizationExplainInput,
  type DbAuthorizationGrantExplanation
} from './authorizationGrants.ts'
import {
  loadActiveRoleConflictRulesWithQueries,
  type RoleConflictEnforcement,
  type StaticRoleConflictRule
} from './staticRoleConflicts.ts'

export interface InstancePrincipalInput {
  kind: string
  uid?: string | null
}

export interface InstanceConflictExplainInput {
  tenantCode: string
  uid: string
  appCode: string
  resourceCode: string
  action: string
  activeRoleCode?: string | null
  authorizationMode?: string | null
  includeBaseline?: boolean
  object?: DbAuthorizationExplainInput['object']
  principals?: InstancePrincipalInput[]
  rules?: StaticRoleConflictRule[]
}

export interface InstanceConflictPrincipal {
  kind: string
  uid: string
  matchesActor: boolean
}

export interface InstanceConflictSideExplanation {
  permission: PermissionTriple
  allowed: boolean
  reasonCode: string
  matchedAction: string | null
  matchedGrant: DbAuthorizationGrantExplanation | null
}

export interface InstanceConflictRuleExplanation {
  ruleCode: string
  ruleName: string
  conflictType: string
  enforcement: RoleConflictEnforcement
  description: string
  requestedSide: 'left' | 'right'
  approvalLike: boolean
  sameActorPrincipals: InstanceConflictPrincipal[]
  status: 'violated' | 'satisfied' | 'not_applicable'
  reasonCode:
    | 'self_approval'
    | 'different_instance_actor'
    | 'missing_requested_permission'
    | 'missing_counterpart_permission'
    | 'non_approval_side'
  message: string
  requested: InstanceConflictSideExplanation
  counterpart: InstanceConflictSideExplanation
}

export interface InstanceConflictExplainResult {
  tenantCode: string
  uid: string
  requested: PermissionTriple
  principals: InstanceConflictPrincipal[]
  hasViolation: boolean
  hasBlockingViolation: boolean
  hasWarningViolation: boolean
  rules: InstanceConflictRuleExplanation[]
}

interface InstanceConflictQueryAdapter extends AuthorizationGrantQueryAdapter {
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
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

function normalizePrincipal(input: InstancePrincipalInput, actorUid: string): InstanceConflictPrincipal | null {
  const kind = stringValue(input.kind)
  const uid = stringValue(input.uid)
  if (!kind || !uid) return null

  return {
    kind,
    uid,
    matchesActor: uid === actorUid
  }
}

function permissionMatchesRuleSide(rulePermission: PermissionTriple | null | undefined, requested: PermissionTriple) {
  if (!rulePermission) return false
  return rulePermission.appCode === requested.appCode
    && rulePermission.resourceCode === requested.resourceCode
    && actionSatisfies(rulePermission.action, requested.action)
}

function isApprovalLike(permission: PermissionTriple) {
  return APPROVAL_LIKE_ACTIONS.has(permission.action)
}

function sideExplanation(
  permission: PermissionTriple,
  result: Awaited<ReturnType<typeof explainDbAuthorizationWithQueries>>
): InstanceConflictSideExplanation {
  return {
    permission,
    allowed: result.allowed,
    reasonCode: result.reasonCode,
    matchedAction: result.matchedAction || null,
    matchedGrant: result.matchedGrant
  }
}

function ruleMessage(input: {
  rule: StaticRoleConflictRule
  status: InstanceConflictRuleExplanation['status']
  sameActorPrincipals: InstanceConflictPrincipal[]
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

async function explainPermission(
  queries: AuthorizationGrantQueryAdapter,
  input: InstanceConflictExplainInput,
  required: PermissionTriple
) {
  return explainDbAuthorizationWithQueries(
    queries,
    input.tenantCode,
    input.uid,
    required.appCode,
    {
      activeRoleCode: input.activeRoleCode,
      authorizationMode: input.authorizationMode,
      allowRoleSimulation: input.authorizationMode === 'role_simulation',
      allowUserSimulation: input.authorizationMode === 'user_simulation',
      includeBaseline: input.includeBaseline,
      required,
      object: input.object
    }
  )
}

export async function explainInstanceConflictsWithQueries(
  queries: InstanceConflictQueryAdapter,
  input: InstanceConflictExplainInput
): Promise<InstanceConflictExplainResult> {
  const requested: PermissionTriple = {
    appCode: input.appCode,
    resourceCode: input.resourceCode,
    action: input.action
  }
  const principals = (input.principals || [])
    .map(principal => normalizePrincipal(principal, input.uid))
    .filter((principal): principal is InstanceConflictPrincipal => Boolean(principal))
  const sameActorPrincipals = principals.filter(principal => principal.matchesActor)
  const rules = input.rules || await loadActiveRoleConflictRulesWithQueries(queries, input.tenantCode)
  const requestedExplain = await explainPermission(queries, input, requested)
  const explanations: InstanceConflictRuleExplanation[] = []

  for (const rule of rules) {
    const leftMatches = permissionMatchesRuleSide(rule.left, requested)
    const rightMatches = permissionMatchesRuleSide(rule.right, requested)
    if (!leftMatches && !rightMatches) continue

    const requestedSide = rightMatches ? 'right' : 'left'
    const counterpartPermission = requestedSide === 'right' ? rule.left : rule.right
    if (!counterpartPermission) continue

    const counterpartExplain = await explainPermission(queries, input, counterpartPermission)
    const approvalLike = isApprovalLike(requested)
    let status: InstanceConflictRuleExplanation['status'] = 'not_applicable'
    let reasonCode: InstanceConflictRuleExplanation['reasonCode'] = 'non_approval_side'

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
      requested: sideExplanation(requested, requestedExplain),
      counterpart: sideExplanation(counterpartPermission, counterpartExplain)
    })
  }

  const violations = explanations.filter(rule => rule.status === 'violated')
  return {
    tenantCode: input.tenantCode,
    uid: input.uid,
    requested,
    principals,
    hasViolation: violations.length > 0,
    hasBlockingViolation: violations.some(rule => rule.enforcement === 'enforce'),
    hasWarningViolation: violations.some(rule => rule.enforcement === 'warning'),
    rules: explanations
  }
}

export async function explainInstanceConflicts(input: InstanceConflictExplainInput) {
  const { queryRow, queryRows } = await import('./db.ts')
  return explainInstanceConflictsWithQueries({ queryRow, queryRows }, input)
}
