export const ROLE_CATALOG_CATEGORIES = [
  { value: 'main_position', label: '主岗位' },
  { value: 'management_duty', label: '管理职责' },
  { value: 'approval_duty', label: '审批职责' },
  { value: 'professional_duty', label: '专业职责' },
  { value: 'high_risk_privilege', label: '高风险特权' },
  { value: 'custom_role', label: '自定义角色' }
] as const

export type RoleCatalogCategory = typeof ROLE_CATALOG_CATEGORIES[number]['value']
export type RoleCatalogCategorySource = 'manual' | 'derived'

const ROLE_CATALOG_CATEGORY_VALUES = new Set<string>(ROLE_CATALOG_CATEGORIES.map(item => item.value))

export interface RoleCatalogCategoryInput {
  roleCode?: string | null
  roleName?: string | null
  description?: string | null
  source?: string | null
  catalogCategory?: string | null
}

export interface RoleCatalogSplitSuggestionInput {
  roleCode?: string | null
  roleName?: string | null
  description?: string | null
  source?: string | null
  category?: string | null
  permissionCount?: number | null
  appRoleCount?: number | null
  assignedUserCount?: number | null
  appCodes?: string[] | null
}

export interface RoleCatalogCategoryResult {
  category: RoleCatalogCategory
  label: string
  source: RoleCatalogCategorySource
}

export function normalizeRoleCatalogCategory(value: unknown): RoleCatalogCategory | null {
  const normalized = String(value || '').trim()
  if (!ROLE_CATALOG_CATEGORY_VALUES.has(normalized)) {
    return null
  }

  return normalized as RoleCatalogCategory
}

export function roleCatalogCategoryLabel(category: string) {
  return ROLE_CATALOG_CATEGORIES.find(item => item.value === category)?.label || '自定义角色'
}

export function roleCatalogCategorySort(category: string) {
  const index = ROLE_CATALOG_CATEGORIES.findIndex(item => item.value === category)
  return index >= 0 ? index : ROLE_CATALOG_CATEGORIES.length
}

export function deriveRoleCatalogCategory(row: RoleCatalogCategoryInput): RoleCatalogCategoryResult {
  const manualCategory = normalizeRoleCatalogCategory(row.catalogCategory)
  if (manualCategory) {
    return {
      category: manualCategory,
      label: roleCatalogCategoryLabel(manualCategory),
      source: 'manual'
    }
  }

  const text = `${row.roleCode || ''} ${row.roleName || ''} ${row.description || ''}`.toLowerCase()
  let category: RoleCatalogCategory = 'main_position'
  if (/(admin|owner|security|deploy|release|root|高权限|安全|发布|管理员)/.test(text)) {
    category = 'high_risk_privilege'
  } else if (/(approve|approval|confirm|audit|review|审批|确认|复核|审计)/.test(text)) {
    category = 'approval_duty'
  } else if (/(manager|leader|lead|head|director|负责人|主管|经理|总监)/.test(text)) {
    category = 'management_duty'
  } else if (row.source === 'custom') {
    category = 'custom_role'
  }

  return {
    category,
    label: roleCatalogCategoryLabel(category),
    source: 'derived'
  }
}

export function generateRoleCatalogSplitSuggestion(input: RoleCatalogSplitSuggestionInput): string | null {
  const permissionCount = Number(input.permissionCount || 0)
  const appRoleCount = Number(input.appRoleCount || 0)
  const assignedUserCount = Number(input.assignedUserCount || 0)
  const appCodes = Array.from(new Set((input.appCodes || []).map(item => item.trim()).filter(Boolean)))
  const category = input.category || deriveRoleCatalogCategory(input).category
  const text = `${input.roleCode || ''} ${input.roleName || ''} ${input.description || ''}`.toLowerCase()
  const hasHighRiskSignal = category === 'high_risk_privilege'
    || /(admin|owner|security|deploy|release|root|高权限|安全|发布|管理员)/.test(text)
  const hasApprovalSignal = category === 'approval_duty'
    || /(approve|approval|confirm|audit|review|审批|确认|复核|审计)/.test(text)
  const wideByPermissions = permissionCount >= 80
  const wideByApps = appCodes.length >= 4 || appRoleCount >= 6
  const unused = assignedUserCount === 0

  if (permissionCount === 0 && appRoleCount === 0) {
    return unused
      ? '当前角色没有权限或应用角色映射且无人使用，建议停用、合并到相近岗位，或补齐职责定义后再授权。'
      : '当前角色没有权限或应用角色映射但已有成员持有，建议先核对是否为历史占位角色，再补齐权限或迁移成员。'
  }

  if (hasHighRiskSignal && (wideByPermissions || wideByApps)) {
    return '该角色同时覆盖高风险能力和较宽应用/权限范围，建议拆为日常主岗位 + 独立高风险特权职责包，并对特权职责设置审批、到期时间和职责冲突规则。'
  }

  if (hasHighRiskSignal) {
    return '该角色包含高风险特权信号，建议不要作为默认主岗位长期授予；优先拆成附加职责或临时授权，并设置到期时间。'
  }

  if (hasApprovalSignal && (wideByPermissions || wideByApps)) {
    return '该角色同时包含审批/确认职责和较宽业务范围，建议拆出审批职责包，避免经办、查看和审批长期绑定在同一主岗位。'
  }

  if (wideByApps) {
    return `该角色覆盖 ${appCodes.length || appRoleCount} 个应用域，建议按应用或业务域拆分为多个附加职责包，保留一个最小主岗位。`
  }

  if (wideByPermissions) {
    return `该角色包含 ${permissionCount} 项权限，建议按查看、经办、审批或高风险操作拆分，减少单个角色的权限面。`
  }

  if (category === 'custom_role' && unused) {
    return '该自定义角色当前无人使用，建议确认是否仍需要；如不需要可停用，如需要则补充治理备注和适用成员。'
  }

  return null
}

export function isRoleCatalogMetadataMissingTableError(error: unknown) {
  const err = error as { code?: string, errno?: number, message?: string }
  return err?.code === 'ER_NO_SUCH_TABLE'
    || err?.errno === 1146
    || String(err?.message || '').includes('tenant_role_catalog_metadata')
}
