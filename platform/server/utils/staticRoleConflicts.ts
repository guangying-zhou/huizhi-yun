import { actionSatisfies, type PermissionTriple } from '@hzy/authz-core'
import type { RowDataPacket } from 'mysql2/promise'

export type RoleConflictEnforcement = 'warning' | 'enforce'

export interface StaticRoleConflictRule {
  ruleCode: string
  ruleName: string
  conflictType: string
  enforcement: RoleConflictEnforcement
  left?: PermissionTriple | null
  right?: PermissionTriple | null
  leftRoleCode?: string | null
  rightRoleCode?: string | null
  description: string
}

export interface RoleConflictRole {
  roleId: number
  roleCode: string
  roleName: string
  permissions: PermissionTriple[]
}

export interface RoleConflictMatch {
  roleId: number
  roleCode: string
  roleName: string
  permission: PermissionTriple | null
}

export interface RoleConflictResult {
  ruleCode: string
  ruleName: string
  conflictType: string
  enforcement: RoleConflictEnforcement
  message: string
  description: string
  left: RoleConflictMatch
  right: RoleConflictMatch
}

export interface RoleConflictEvaluation {
  conflicts: RoleConflictResult[]
  warnings: RoleConflictResult[]
  blockingConflicts: RoleConflictResult[]
}

interface AssignmentRoleRow extends RowDataPacket {
  role_id: number
  role_code: string
  role_name: string
}

interface PermissionRow extends RowDataPacket {
  role_id: number
  app_code: string
  resource_code: string
  action: string
}

interface TenantRoleConflictRuleRow extends RowDataPacket {
  rule_code: string
  rule_name: string
  conflict_type: string
  enforcement: string
  left_role_code: string | null
  right_role_code: string | null
  left_app_code: string | null
  left_resource_code: string | null
  left_action: string | null
  right_app_code: string | null
  right_resource_code: string | null
  right_action: string | null
  description: string | null
}

export interface StaticRoleConflictQueryAdapter {
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
}

export interface SubjectRoleConflictInput {
  tenantCode: string
  subjectId: number
  candidateRole: {
    roleId: number
    roleCode: string
    roleName: string
  }
  assignmentStatus?: string | null
  startsAt?: string | null
  expiredAt?: string | null
  rules?: StaticRoleConflictRule[]
}

export const STATIC_ROLE_CONFLICT_RULES: StaticRoleConflictRule[] = [
  {
    ruleCode: 'finance-expense-maker-confirmation',
    ruleName: '付款制单与付款确认分离',
    conflictType: 'segregation_of_duties',
    enforcement: 'warning',
    left: { appCode: 'finance', resourceCode: 'expenses', action: 'edit' },
    right: { appCode: 'finance', resourceCode: 'expenses', action: 'confirm' },
    description: '允许小团队兼任，但付款确认必须由非制单/经办人执行。'
  },
  {
    ruleCode: 'finance-expense-maker-approval',
    ruleName: '费用制单与费用审批分离',
    conflictType: 'segregation_of_duties',
    enforcement: 'warning',
    left: { appCode: 'finance', resourceCode: 'expenses', action: 'edit' },
    right: { appCode: 'finance', resourceCode: 'expenses', action: 'approve' },
    description: '允许兼任岗位职责，但实例审批必须保留非申请人证据。'
  },
  {
    ruleCode: 'assets-purchase-operator-approval',
    ruleName: '采购经办与采购审批分离',
    conflictType: 'segregation_of_duties',
    enforcement: 'warning',
    left: { appCode: 'assets', resourceCode: 'purchase_orders', action: 'edit' },
    right: { appCode: 'assets', resourceCode: 'purchase_orders', action: 'approve' },
    description: '采购经办和采购审批长期兼任时，应在业务实例上强制另一人审批。'
  },
  {
    ruleCode: 'assets-assignment-operator-approval',
    ruleName: '资产操作与资产审批分离',
    conflictType: 'segregation_of_duties',
    enforcement: 'warning',
    left: { appCode: 'assets', resourceCode: 'assignments', action: 'edit' },
    right: { appCode: 'assets', resourceCode: 'assignments', action: 'approve' },
    description: '资产分配、领用、退回或报废审批不应由同一业务实例经办人完成。'
  },
  {
    ruleCode: 'people-assignment-operator-approval',
    ruleName: '任职变更经办与审批分离',
    conflictType: 'segregation_of_duties',
    enforcement: 'warning',
    left: { appCode: 'people', resourceCode: 'assignments', action: 'edit' },
    right: { appCode: 'people', resourceCode: 'assignments', action: 'approve' },
    description: '入转调离经办和审批长期兼任时，应保留实例级双人确认。'
  },
  {
    ruleCode: 'people-cost-operator-approval',
    ruleName: '人员成本维护与审批分离',
    conflictType: 'segregation_of_duties',
    enforcement: 'warning',
    left: { appCode: 'people', resourceCode: 'cost_snapshots', action: 'edit' },
    right: { appCode: 'people', resourceCode: 'cost_snapshots', action: 'approve' },
    description: '人员成本调整的经办和审批不应在同一业务实例中由同一人完成。'
  },
  {
    ruleCode: 'people-performance-operator-approval',
    ruleName: '绩效周期维护与确认分离',
    conflictType: 'segregation_of_duties',
    enforcement: 'warning',
    left: { appCode: 'people', resourceCode: 'performance_cycles', action: 'edit' },
    right: { appCode: 'people', resourceCode: 'performance_cycles', action: 'approve' },
    description: '绩效周期维护与确认长期兼任时，应在周期确认上保留复核人。'
  },
  {
    ruleCode: 'webdev-execute-deploy',
    ruleName: '开发执行与生产部署分离',
    conflictType: 'segregation_of_duties',
    enforcement: 'warning',
    left: { appCode: 'webdev', resourceCode: 'webdev_workspace', action: 'execute' },
    right: { appCode: 'webdev', resourceCode: 'webdev_workspace', action: 'deploy' },
    description: '同一人同时具备执行和部署能力时，生产部署应保留复核或发布审批。'
  }
]

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function permissionKey(permission: PermissionTriple) {
  return `${permission.appCode}:${permission.resourceCode}:${permission.action}`
}

function optionalPermissionKey(permission: PermissionTriple | null) {
  return permission ? permissionKey(permission) : 'role-only'
}

function rolePermissionMatches(permission: PermissionTriple, required: PermissionTriple) {
  return permission.appCode === required.appCode
    && permission.resourceCode === required.resourceCode
    && actionSatisfies(permission.action, required.action)
}

function firstMatchingPermission(role: RoleConflictRole, required: PermissionTriple) {
  return role.permissions.find(permission => rolePermissionMatches(permission, required)) || null
}

function sideHasConstraint(roleCode?: string | null, permission?: PermissionTriple | null) {
  return Boolean(stringValue(roleCode) || permission)
}

function matchConflictSide(role: RoleConflictRole, roleCode?: string | null, required?: PermissionTriple | null) {
  const normalizedRoleCode = stringValue(roleCode)
  if (normalizedRoleCode && role.roleCode !== normalizedRoleCode) return null
  if (!required) {
    return {
      role,
      permission: null
    }
  }

  const permission = firstMatchingPermission(role, required)
  if (!permission) return null
  return {
    role,
    permission
  }
}

function roleConflictMessage(rule: StaticRoleConflictRule, left: RoleConflictRole, right: RoleConflictRole) {
  const sameRole = left.roleCode === right.roleCode
  const roleText = sameRole
    ? `${left.roleName || left.roleCode}`
    : `${left.roleName || left.roleCode} 与 ${right.roleName || right.roleCode}`
  const enforcementText = rule.enforcement === 'enforce'
    ? '禁止同时持有。'
    : '允许兼任，但业务实例必须保留双人校验。'
  return `${roleText} 触发“${rule.ruleName}”：${enforcementText}`
}

export function evaluateStaticRoleConflicts(
  roles: RoleConflictRole[],
  rules: StaticRoleConflictRule[] = STATIC_ROLE_CONFLICT_RULES
): RoleConflictEvaluation {
  const conflicts: RoleConflictResult[] = []
  const seen = new Set<string>()

  for (const rule of rules) {
    if (!sideHasConstraint(rule.leftRoleCode, rule.left) || !sideHasConstraint(rule.rightRoleCode, rule.right)) {
      continue
    }

    for (let leftIndex = 0; leftIndex < roles.length; leftIndex += 1) {
      for (let rightIndex = leftIndex; rightIndex < roles.length; rightIndex += 1) {
        const leftRole = roles[leftIndex]
        const rightRole = roles[rightIndex]
        if (!leftRole || !rightRole) continue

        const pairs: Array<[RoleConflictRole, RoleConflictRole]> = leftRole === rightRole
          ? [[leftRole, rightRole]]
          : [[leftRole, rightRole], [rightRole, leftRole]]

        for (const [candidateLeft, candidateRight] of pairs) {
          const leftMatch = matchConflictSide(candidateLeft, rule.leftRoleCode, rule.left)
          const rightMatch = matchConflictSide(candidateRight, rule.rightRoleCode, rule.right)
          if (!leftMatch || !rightMatch) continue

          const pairKey = [candidateLeft.roleCode, candidateRight.roleCode].sort().join('|')
          const key = `${rule.ruleCode}:${pairKey}:${optionalPermissionKey(leftMatch.permission)}:${optionalPermissionKey(rightMatch.permission)}`
          if (seen.has(key)) continue
          seen.add(key)

          conflicts.push({
            ruleCode: rule.ruleCode,
            ruleName: rule.ruleName,
            conflictType: rule.conflictType,
            enforcement: rule.enforcement,
            message: roleConflictMessage(rule, candidateLeft, candidateRight),
            description: rule.description,
            left: {
              roleId: candidateLeft.roleId,
              roleCode: candidateLeft.roleCode,
              roleName: candidateLeft.roleName,
              permission: leftMatch.permission
            },
            right: {
              roleId: candidateRight.roleId,
              roleCode: candidateRight.roleCode,
              roleName: candidateRight.roleName,
              permission: rightMatch.permission
            }
          })
        }
      }
    }
  }

  return {
    conflicts,
    warnings: conflicts.filter(conflict => conflict.enforcement === 'warning'),
    blockingConflicts: conflicts.filter(conflict => conflict.enforcement === 'enforce')
  }
}

function permissionFromRow(row: TenantRoleConflictRuleRow, side: 'left' | 'right') {
  const appCode = stringValue(side === 'left' ? row.left_app_code : row.right_app_code)
  const resourceCode = stringValue(side === 'left' ? row.left_resource_code : row.right_resource_code)
  const action = stringValue(side === 'left' ? row.left_action : row.right_action)
  if (!appCode || !resourceCode || !action) return null

  return {
    appCode,
    resourceCode,
    action
  }
}

function normalizeEnforcement(value: unknown): RoleConflictEnforcement {
  return stringValue(value) === 'enforce' ? 'enforce' : 'warning'
}

function tenantRuleFromRow(row: TenantRoleConflictRuleRow): StaticRoleConflictRule | null {
  const ruleCode = stringValue(row.rule_code)
  const ruleName = stringValue(row.rule_name) || ruleCode
  const leftRoleCode = stringValue(row.left_role_code) || null
  const rightRoleCode = stringValue(row.right_role_code) || null
  const left = permissionFromRow(row, 'left')
  const right = permissionFromRow(row, 'right')
  if (!ruleCode || !sideHasConstraint(leftRoleCode, left) || !sideHasConstraint(rightRoleCode, right)) {
    return null
  }

  return {
    ruleCode,
    ruleName,
    conflictType: stringValue(row.conflict_type) || 'segregation_of_duties',
    enforcement: normalizeEnforcement(row.enforcement),
    left,
    right,
    leftRoleCode,
    rightRoleCode,
    description: stringValue(row.description) || ruleName
  }
}

function isMissingConflictRuleTableError(error: unknown) {
  const err = error as { code?: string, errno?: number, message?: string }
  return err?.code === 'ER_NO_SUCH_TABLE'
    || err?.errno === 1146
    || String(err?.message || '').includes('tenant_role_conflict_rules')
}

function mergeConflictRules(baseRules: StaticRoleConflictRule[], tenantRules: StaticRoleConflictRule[]) {
  const rulesByCode = new Map<string, StaticRoleConflictRule>()
  for (const rule of baseRules) {
    rulesByCode.set(rule.ruleCode, rule)
  }
  for (const rule of tenantRules) {
    rulesByCode.set(rule.ruleCode, rule)
  }
  return [...rulesByCode.values()]
}

async function loadTenantRoleConflictRules(
  queries: StaticRoleConflictQueryAdapter,
  tenantCode: string
) {
  try {
    const rows = await queries.queryRows<TenantRoleConflictRuleRow[]>(
      `SELECT rule_code, rule_name, conflict_type, enforcement,
              left_role_code, right_role_code,
              left_app_code, left_resource_code, left_action,
              right_app_code, right_resource_code, right_action,
              description
       FROM tenant_role_conflict_rules
       WHERE tenant_code = ?
         AND status = 'active'
       ORDER BY rule_code`,
      [tenantCode]
    )

    return rows
      .map(row => tenantRuleFromRow(row))
      .filter((rule): rule is StaticRoleConflictRule => Boolean(rule))
  } catch (error) {
    if (isMissingConflictRuleTableError(error)) return []
    throw error
  }
}

async function loadExistingEffectiveRoles(
  queries: StaticRoleConflictQueryAdapter,
  input: SubjectRoleConflictInput
) {
  const candidateExpiredAt = input.expiredAt || null
  const candidateStartsAt = input.startsAt || null
  return queries.queryRows<AssignmentRoleRow[]>(
    `SELECT DISTINCT tr.id AS role_id, tr.role_code, tr.role_name
     FROM tenant_subject_roles tsr
     INNER JOIN tenant_roles tr
       ON tr.id = tsr.role_id
      AND tr.tenant_code = tsr.tenant_code
     WHERE tsr.tenant_code = ?
       AND tsr.subject_id = ?
       AND tsr.status = 'active'
       AND (tsr.expired_at IS NULL OR tsr.expired_at > UTC_TIMESTAMP())
       AND (? IS NULL OR tsr.starts_at IS NULL OR tsr.starts_at < ?)
       AND (tsr.expired_at IS NULL OR ? IS NULL OR tsr.expired_at > ?)
       AND tr.status = 'active'
       AND tr.is_assignable = 1
     ORDER BY tr.role_code`,
    [
      input.tenantCode,
      input.subjectId,
      candidateExpiredAt,
      candidateExpiredAt,
      candidateStartsAt,
      candidateStartsAt
    ]
  )
}

async function loadRolePermissions(
  queries: StaticRoleConflictQueryAdapter,
  tenantCode: string,
  roleIds: number[]
) {
  const ids = [...new Set(roleIds.filter(roleId => Number.isInteger(roleId) && roleId > 0))]
  if (!ids.length) return []

  const placeholders = ids.map(() => '?').join(', ')
  return queries.queryRows<PermissionRow[]>(
    `SELECT role_id, app_code, resource_code, action
     FROM tenant_role_permissions
     WHERE tenant_code = ?
       AND role_id IN (${placeholders})
     UNION ALL
     SELECT tram.role_id, arp.app_code, arp.resource_code, arp.action
     FROM tenant_role_app_role_maps tram
     INNER JOIN platform_app_roles ar
       ON ar.role_code = tram.app_role_code
      AND ar.status = 'active'
     INNER JOIN platform_app_role_permissions arp
       ON arp.app_role_id = ar.id
     WHERE tram.tenant_code = ?
       AND tram.role_id IN (${placeholders})`,
    [tenantCode, ...ids, tenantCode, ...ids]
  )
}

function rowsToConflictRoles(roleRows: AssignmentRoleRow[], permissionRows: PermissionRow[]) {
  const permissionsByRoleId = new Map<number, PermissionTriple[]>()
  for (const row of permissionRows) {
    const roleId = Number(row.role_id)
    const permission: PermissionTriple = {
      appCode: stringValue(row.app_code),
      resourceCode: stringValue(row.resource_code),
      action: stringValue(row.action)
    }
    if (!permission.appCode || !permission.resourceCode || !permission.action) continue

    const permissions = permissionsByRoleId.get(roleId) || []
    permissions.push(permission)
    permissionsByRoleId.set(roleId, permissions)
  }

  return roleRows.map(row => ({
    roleId: Number(row.role_id),
    roleCode: stringValue(row.role_code),
    roleName: stringValue(row.role_name) || stringValue(row.role_code),
    permissions: permissionsByRoleId.get(Number(row.role_id)) || []
  }))
}

function shouldEvaluateAssignment(input: SubjectRoleConflictInput) {
  if (stringValue(input.assignmentStatus || 'active') !== 'active') return false
  if (!input.candidateRole.roleId || !input.candidateRole.roleCode) return false

  const expiredAt = input.expiredAt ? new Date(input.expiredAt.replace(' ', 'T') + 'Z') : null
  if (expiredAt && !Number.isNaN(expiredAt.getTime()) && expiredAt.getTime() <= Date.now()) {
    return false
  }

  return true
}

export async function evaluateSubjectRoleAssignmentConflictsWithQueries(
  queries: StaticRoleConflictQueryAdapter,
  input: SubjectRoleConflictInput
) {
  if (!shouldEvaluateAssignment(input)) {
    return evaluateStaticRoleConflicts([], input.rules)
  }

  const existingRows = await loadExistingEffectiveRoles(queries, input)
  const roleById = new Map<number, AssignmentRoleRow>()
  for (const row of existingRows) {
    roleById.set(Number(row.role_id), row)
  }
  roleById.set(input.candidateRole.roleId, {
    role_id: input.candidateRole.roleId,
    role_code: input.candidateRole.roleCode,
    role_name: input.candidateRole.roleName
  } as AssignmentRoleRow)

  const roleRows = [...roleById.values()]
  const permissionRows = await loadRolePermissions(
    queries,
    input.tenantCode,
    roleRows.map(row => Number(row.role_id))
  )
  const rules = input.rules
    || mergeConflictRules(STATIC_ROLE_CONFLICT_RULES, await loadTenantRoleConflictRules(queries, input.tenantCode))

  return evaluateStaticRoleConflicts(rowsToConflictRoles(roleRows, permissionRows), rules)
}

export async function evaluateSubjectRoleAssignmentConflicts(input: SubjectRoleConflictInput) {
  const { queryRows: dbQueryRows } = await import('./db.ts')
  return evaluateSubjectRoleAssignmentConflictsWithQueries({ queryRows: dbQueryRows }, input)
}
