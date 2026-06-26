import type { WorkItemType, WorkItemTier, Priority, Severity } from '~/types/aims'

// ============================================================
// 工作项层级配置
// ============================================================

export const tierConfig: Record<WorkItemTier, { label: string, color: string, icon: string }> = {
  target: { label: '目标', color: 'primary', icon: 'i-lucide-target' },
  matter: { label: '事项', color: 'neutral', icon: 'i-lucide-circle-dot' }
}

export const tierOptions = Object.entries(tierConfig).map(([value, cfg]) => ({
  label: cfg.label,
  value
}))

// ============================================================
// 工作项类型配置
// ============================================================

export const typeConfig: Record<WorkItemType, { label: string, icon: string, color: string }> = {
  requirement: { label: '需求', icon: 'i-lucide-file-text', color: 'text-secondary' },
  task: { label: '任务', icon: 'i-lucide-target', color: 'text-secondary' },
  bug: { label: '缺陷', icon: 'i-lucide-bug', color: 'text-error' }
}

export const typeOptions = Object.entries(typeConfig).map(([value, cfg]) => ({
  label: cfg.label,
  value
}))

// ============================================================
// 优先级配置
// ============================================================

export const priorityConfig: Record<Priority, { label: string, color: string, icon: string }> = {
  P0: { label: '紧急P0', color: 'error', icon: 'i-lucide-alert-circle' },
  P1: { label: '高P1', color: 'warning', icon: 'i-lucide-arrow-up' },
  P2: { label: '中P2', color: 'primary', icon: 'i-lucide-minus' },
  P3: { label: '低P3', color: 'neutral', icon: 'i-lucide-arrow-down' }
}

export const priorityOptions = Object.entries(priorityConfig).map(([value, cfg]) => ({
  label: cfg.label,
  value
}))

// ============================================================
// 严重程度配置（仅缺陷）
// ============================================================

export const severityConfig: Record<Severity, { label: string, color: string }> = {
  critical: { label: '致命', color: 'error' },
  high: { label: '严重', color: 'warning' },
  medium: { label: '一般', color: 'primary' },
  low: { label: '轻微', color: 'info' },
  suggestion: { label: '建议', color: 'neutral' }
}

export const severityOptions = Object.entries(severityConfig).map(([value, cfg]) => ({
  label: cfg.label,
  value
}))

// ============================================================
// 工作项状态配置
// ============================================================
// Target 层：planning → todo → in_progress → in_review → completed
// Matter 层：todo → in_progress → in_review → completed

export const statusConfig: Record<string, { label: string, color: string }> = {
  planning: { label: '目标规划', color: 'neutral' },
  todo: { label: '任务分解', color: 'info' },
  in_progress: { label: '执行中', color: 'primary' },
  in_review: { label: '确认中', color: 'warning' },
  completed: { label: '已完成', color: 'success' }
}

/** 获取状态标签 */
export function getStatusLabel(status: string): string {
  return statusConfig[status]?.label || status
}

/** 获取状态颜色 */
export function getStatusColor(status: string): string {
  return statusConfig[status]?.color || 'neutral'
}

// ============================================================
// 状态流转标签
// ============================================================

export const transitionLabels: Record<string, string> = {
  decompose: '分解任务',
  start: '开始执行',
  reset: '退回任务分解',
  submit: '提交确认',
  approve: '确认完成',
  reject: '退回修改',
  reopen: '重新打开'
}

// ============================================================
// 按层级获取可用状态选项
// ============================================================

export const targetStatuses = ['planning', 'todo', 'in_progress', 'in_review', 'completed'] as const
export const matterStatuses = ['todo', 'in_progress', 'in_review', 'completed'] as const

export function getStatusOptions(_type?: WorkItemType, tier?: WorkItemTier) {
  if (tier === 'matter') {
    return matterStatuses.map(s => ({ label: statusConfig[s]!.label, value: s }))
  }
  if (tier === 'target') {
    return targetStatuses.map(s => ({ label: statusConfig[s]!.label, value: s }))
  }
  // 全部状态（去重）
  return targetStatuses.map(s => ({ label: statusConfig[s]!.label, value: s }))
}

// 兼容旧代码引用
export const requirementStatuses = targetStatuses
export const taskStatuses = matterStatuses
export const bugStatuses = targetStatuses

// ============================================================
// 交付物类型配置
// ============================================================

export const deliverableTypeLabel: Record<string, string> = {
  document: '文档',
  code: '代码',
  artifact: '制品',
  task: '任务'
}

export const deliverableTypeIcon: Record<string, string> = {
  document: 'i-lucide-file-text',
  code: 'i-lucide-git-branch',
  artifact: 'i-lucide-package',
  task: 'i-lucide-clipboard-list'
}

export const deliverableTypeOptions = [
  { label: '文档', value: 'document' },
  { label: '代码', value: 'code' },
  { label: '制品', value: 'artifact' },
  { label: '任务', value: 'task' }
]

/** 允许同时被多个任务成果引用的目标成果类型（主要是 code——多人协作提交代码） */
export const MULTI_ASSIGN_DELIVERABLE_TYPES = new Set(['code'])

// ============================================================
// 评审级别
// ============================================================

export const reviewLevelOptions = [
  { label: '免评审', value: 0 },
  { label: '一般', value: 1 },
  { label: '重要', value: 2 },
  { label: '重大', value: 3 },
  { label: '关键', value: 4 }
]

export const reviewLevelLabel: Record<number, string> = {
  0: '免评审',
  1: '一般',
  2: '重要',
  3: '重大',
  4: '关键'
}
