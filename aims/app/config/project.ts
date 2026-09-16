import type { LifecycleStatus, ProjectCategory, Methodology, ProjectConfidentialityLevel, ProjectSecurityLevel, ModuleConfig } from '~/types/aims'
import { projectModuleDefaultConfig } from '~/utils/projectModuleConfig'

// 简称校验规则见 ~/utils/projectShortName（零依赖，便于单测直接加载）
export { validateProjectShortName } from '~/utils/projectShortName'

// ============================================================
// 项目状态配置
// ============================================================

export const projectStatusConfig: Record<LifecycleStatus, { label: string, color: string, icon: string }> = {
  draft: { label: '草稿', color: 'neutral', icon: 'i-lucide-file-edit' },
  approval_pending: { label: '待立项', color: 'warning', icon: 'i-lucide-clock' },
  active: { label: '进行中', color: 'success', icon: 'i-lucide-play' },
  paused: { label: '已暂停', color: 'info', icon: 'i-lucide-pause' },
  completed: { label: '已完成', color: 'primary', icon: 'i-lucide-check-circle' },
  archived: { label: '已归档', color: 'neutral', icon: 'i-lucide-archive' }
}

export const projectStatusOptions = Object.entries(projectStatusConfig).map(([value, cfg]) => ({
  label: cfg.label,
  value
}))

// ============================================================
// 项目类型配置
// ============================================================

export const projectCategoryConfig: Record<ProjectCategory, { label: string, icon: string }> = {
  product_dev: { label: '产品开发', icon: 'i-lucide-rocket' },
  custom_dev: { label: '定制开发', icon: 'i-lucide-code' },
  delivery: { label: '实施交付', icon: 'i-lucide-truck' },
  maintenance: { label: '维保项目', icon: 'i-lucide-wrench' },
  sales: { label: '销售项目', icon: 'i-lucide-handshake' },
  presales: { label: '售前项目', icon: 'i-lucide-presentation' },
  /** @deprecated V1.1 已停用，保留供存量项目显示 */
  improvement: { label: '改进（已停用）', icon: 'i-lucide-trending-up' },
  compliance: { label: '合规审计', icon: 'i-lucide-shield-check' },
  routine: { label: '日常事务', icon: 'i-lucide-inbox' }
}

/**
 * 分类名称的唯一来源。
 *
 * 规范来源：《汇智PIVR项目管理生命周期模型说明书V1.1》§3 业务场景适配映射表。
 * 组件与页面一律从此处取名，不得再维护本地分类字典——历史上曾出现 6 份字典、
 * 4 套用词（如「产品开发」/「产品研发」、「实施交付」/「交付实施」）。
 */
export const projectCategoryLabels = Object.fromEntries(
  Object.entries(projectCategoryConfig).map(([value, cfg]) => [value, cfg.label])
) as Record<ProjectCategory, string>

/**
 * 可在创建入口手工选择的分类。
 *
 * 排除项：
 *   - improvement：V1.1 已停用，改进类工作归入产品版本迭代 / 维保范围 / 日常事务
 *   - routine：日常事务容器只能在「日常事务」项目集下创建，分类为强约束（见 V1.1 §1.4）
 */
export const selectableProjectCategories: ProjectCategory[] = [
  'product_dev',
  'custom_dev',
  'delivery',
  'maintenance',
  'sales',
  'presales',
  'compliance'
]

/** 全部分类，含已停用与派生分类。用于筛选器等需要覆盖存量数据的场景。 */
export const allProjectCategories = Object.keys(projectCategoryConfig) as ProjectCategory[]

/** 取分类显示名；未知分类回落为原始 code，便于发现漏配 */
export function getProjectCategoryLabel(category: ProjectCategory | string | undefined | null): string {
  if (!category) return ''
  return projectCategoryLabels[category as ProjectCategory] || String(category)
}

/**
 * 全部分类选项，含已停用的 improvement 与派生的 routine。
 * 用于筛选器、模板管理等需要覆盖存量数据的场景。
 */
export const projectCategoryOptions = Object.entries(projectCategoryConfig).map(([value, cfg]) => ({
  label: cfg.label,
  value
}))

/**
 * 创建入口的分类选项，见 selectableProjectCategories。
 * 页面不要自建选项数组——历史上曾有 4 处各自维护且用词与列表页不一致。
 */
export const selectableProjectCategoryOptions = selectableProjectCategories.map(value => ({
  label: projectCategoryConfig[value].label,
  value
}))

// ============================================================
// 项目可见范围配置
// ============================================================

export const projectSecurityLevelConfig: Record<ProjectSecurityLevel, { label: string, color: string, icon: string, description: string }> = {
  company: {
    label: '公司范围可见',
    color: 'success',
    icon: 'i-lucide-building-2',
    description: '企业内登录用户均可查看项目。'
  },
  department: {
    label: '部门范围可见',
    color: 'info',
    icon: 'i-lucide-users',
    description: '项目所属部门用户、项目负责人和项目成员可查看；部门经理、分管领导和上级部门领导不受限制。'
  },
  project_team: {
    label: '项目组可见',
    color: 'secondary',
    icon: 'i-lucide-users-round',
    description: '仅项目负责人、创建人和项目成员可查看；部门经理、分管领导和上级部门领导不受限制。'
  },
  whitelist: {
    label: '白名单',
    color: 'warning',
    icon: 'i-lucide-lock-keyhole',
    description: '仅项目负责人、创建人、项目成员和白名单用户可查看；部门经理、分管领导和上级部门领导不受限制。'
  }
}

export const projectSecurityLevelOptions = Object.entries(projectSecurityLevelConfig).map(([value, cfg]) => ({
  label: cfg.label,
  value
}))

// ============================================================
// 项目密级配置
// ============================================================

export const projectConfidentialityLevelConfig: Record<ProjectConfidentialityLevel, { label: string, color: string, icon: string, description: string }> = {
  L0: {
    label: 'L0-公开',
    color: 'success',
    icon: 'i-lucide-globe-2',
    description: '不含敏感信息，可按所选可见范围开放。'
  },
  L1: {
    label: 'L1-内部',
    color: 'info',
    icon: 'i-lucide-building-2',
    description: '企业内部项目信息，按所选可见范围控制访问。'
  },
  L2: {
    label: 'L2-机密',
    color: 'warning',
    icon: 'i-lucide-shield-alert',
    description: '机密项目最宽只允许部门范围，选择公司范围时会自动收紧。'
  },
  L3: {
    label: 'L3-绝密',
    color: 'error',
    icon: 'i-lucide-lock-keyhole',
    description: '绝密项目仅允许项目组或白名单访问，部门范围放行不再生效。'
  }
}

export const projectConfidentialityLevelOptions = Object.entries(projectConfidentialityLevelConfig).map(([value, cfg]) => ({
  label: cfg.label,
  value
}))

// ============================================================
// 方法论配置
// ============================================================

export const methodologyConfig: Record<Methodology, { label: string }> = {
  PIVR: { label: 'PIVR模型' },
  agile: { label: '敏捷开发' },
  waterfall: { label: '瀑布模型' },
  kanban: { label: '看板模式' },
  hybrid: { label: '混合模式' }
}

export const methodologyOptions = Object.entries(methodologyConfig).map(([value, cfg]) => ({
  label: cfg.label,
  value
}))

export type { ModuleConfig }

export const defaultModuleConfig: ModuleConfig = { ...projectModuleDefaultConfig }
