import type { LifecycleStatus, ProjectCategory, Methodology, ProjectSecurityLevel } from '~/types/aims'

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
  improvement: { label: '持续改进', icon: 'i-lucide-trending-up' },
  compliance: { label: '合规审计', icon: 'i-lucide-shield-check' }
}

export const projectCategoryOptions = Object.entries(projectCategoryConfig).map(([value, cfg]) => ({
  label: cfg.label,
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

// ============================================================
// 模块开关类型定义
// ============================================================

export interface ModuleConfig {
  milestones: boolean
  workflows: boolean
  requirements: boolean
}

export const defaultModuleConfig: ModuleConfig = {
  milestones: true,
  workflows: true,
  requirements: true
}
