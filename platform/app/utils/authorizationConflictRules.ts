export type AuthorizationConflictEnforcement = 'warning' | 'enforce'
export type AuthorizationConflictRuleStatus = 'active' | 'disabled'

export interface AuthorizationConflictRule {
  id?: number
  tenantCode?: string
  ruleCode: string
  ruleName: string
  conflictType: string
  enforcement: AuthorizationConflictEnforcement
  leftRoleCode: string
  rightRoleCode: string
  leftAppCode: string
  leftResourceCode: string
  leftAction: string
  rightAppCode: string
  rightResourceCode: string
  rightAction: string
  description: string
  status: AuthorizationConflictRuleStatus
}

export interface AuthorizationConflictRuleApiItem extends Omit<AuthorizationConflictRule,
  'enforcement' | 'leftRoleCode' | 'rightRoleCode' | 'leftAppCode' | 'leftResourceCode' | 'leftAction'
  | 'rightAppCode' | 'rightResourceCode' | 'rightAction' | 'description' | 'status'> {
  enforcement: string
  leftRoleCode: string | null
  rightRoleCode: string | null
  leftAppCode: string | null
  leftResourceCode: string | null
  leftAction: string | null
  rightAppCode: string | null
  rightResourceCode: string | null
  rightAction: string | null
  description: string | null
  status: string
}

function normalizedString(value: string | null | undefined) {
  return String(value || '').trim()
}

export function normalizeAuthorizationConflictRule(
  rule: AuthorizationConflictRule | AuthorizationConflictRuleApiItem
): AuthorizationConflictRule {
  return {
    ...rule,
    ruleCode: normalizedString(rule.ruleCode),
    ruleName: normalizedString(rule.ruleName),
    conflictType: normalizedString(rule.conflictType || 'segregation_of_duties'),
    enforcement: rule.enforcement === 'enforce' ? 'enforce' : 'warning',
    leftRoleCode: normalizedString(rule.leftRoleCode),
    rightRoleCode: normalizedString(rule.rightRoleCode),
    leftAppCode: normalizedString(rule.leftAppCode),
    leftResourceCode: normalizedString(rule.leftResourceCode),
    leftAction: normalizedString(rule.leftAction),
    rightAppCode: normalizedString(rule.rightAppCode),
    rightResourceCode: normalizedString(rule.rightResourceCode),
    rightAction: normalizedString(rule.rightAction),
    description: normalizedString(rule.description),
    status: rule.status === 'disabled' ? 'disabled' : 'active'
  }
}

export function createAuthorizationConflictRuleDraft(
  rule?: AuthorizationConflictRule | AuthorizationConflictRuleApiItem | null
): AuthorizationConflictRule {
  return normalizeAuthorizationConflictRule(rule || {
    ruleCode: '',
    ruleName: '',
    conflictType: 'segregation_of_duties',
    enforcement: 'warning',
    leftRoleCode: '',
    rightRoleCode: '',
    leftAppCode: '',
    leftResourceCode: '',
    leftAction: '',
    rightAppCode: '',
    rightResourceCode: '',
    rightAction: '',
    description: '',
    status: 'active'
  })
}

export function validateAuthorizationConflictRule(rule: AuthorizationConflictRule) {
  const hasPermission = (side: 'left' | 'right') => {
    const appCode = side === 'left' ? rule.leftAppCode : rule.rightAppCode
    const resourceCode = side === 'left' ? rule.leftResourceCode : rule.rightResourceCode
    const action = side === 'left' ? rule.leftAction : rule.rightAction
    return Boolean(appCode && resourceCode && action)
  }
  const hasAnyPermissionPart = (side: 'left' | 'right') => {
    const appCode = side === 'left' ? rule.leftAppCode : rule.rightAppCode
    const resourceCode = side === 'left' ? rule.leftResourceCode : rule.rightResourceCode
    const action = side === 'left' ? rule.leftAction : rule.rightAction
    return Boolean(appCode || resourceCode || action)
  }
  const hasSide = (side: 'left' | 'right') => {
    const roleCode = side === 'left' ? rule.leftRoleCode : rule.rightRoleCode
    return Boolean(roleCode || hasPermission(side))
  }

  if (!rule.ruleCode || !rule.ruleName) return '规则编码和名称不能为空。'
  for (const side of ['left', 'right'] as const) {
    if (hasAnyPermissionPart(side) && !hasPermission(side)) {
      return `${side === 'left' ? '左侧' : '右侧'}权限必须同时填写应用编码、业务对象和操作。`
    }
    if (!hasSide(side)) {
      return `${side === 'left' ? '左侧' : '右侧'}必须填写角色编码或完整权限三元组。`
    }
  }
  return ''
}

export function hasDuplicateAuthorizationConflictRuleCode(
  rules: readonly AuthorizationConflictRule[],
  ruleCode: string,
  editingIndex: number
) {
  return rules.some((rule, index) => rule.ruleCode === ruleCode && index !== editingIndex)
}

export function replaceAuthorizationConflictRule(
  rules: readonly AuthorizationConflictRule[],
  rule: AuthorizationConflictRule,
  editingIndex: number
) {
  const nextRules = [...rules]
  if (editingIndex >= 0) nextRules.splice(editingIndex, 1, rule)
  else nextRules.push(rule)
  return nextRules
}

export function toggleAuthorizationConflictRuleStatus(
  rules: readonly AuthorizationConflictRule[],
  index: number
) {
  const rule = rules[index]
  if (!rule) return [...rules]
  return replaceAuthorizationConflictRule(rules, {
    ...rule,
    status: rule.status === 'active' ? 'disabled' : 'active'
  }, index)
}
