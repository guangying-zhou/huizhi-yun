import { deliverableTypeLabel } from '../config/work-item'

export type ProjectBadgeColor = 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'error'
export type ProjectBadge = { label: string, color: ProjectBadgeColor }

export const deliverableStatusConfig: Record<string, ProjectBadge> = {
  pending: { label: '待提交', color: 'neutral' },
  submitted: { label: '已提交', color: 'info' },
  approved: { label: '已通过', color: 'success' },
  rejected: { label: '已驳回', color: 'error' }
}

export const qualityStatusConfig: Record<string, ProjectBadge> = {
  not_submitted: { label: '未送检', color: 'neutral' },
  pending: { label: '未送检', color: 'neutral' },
  preparing_review: { label: '送检准备中', color: 'warning' },
  awaiting_review: { label: '质量待审', color: 'info' },
  returned: { label: '质量退回', color: 'error' },
  passed: { label: '质量通过', color: 'success' },
  waived: { label: '已豁免', color: 'warning' }
}

export const deliverableTypeConfig: Record<string, ProjectBadge> = {
  document: { label: deliverableTypeLabel.document || '文档', color: 'info' },
  code: { label: deliverableTypeLabel.code || '代码', color: 'primary' },
  artifact: { label: deliverableTypeLabel.artifact || '制品', color: 'warning' },
  task: { label: deliverableTypeLabel.task || '任务', color: 'neutral' }
}

export const releaseStatusConfig: Record<string, ProjectBadge> = {
  planning: { label: '规划中', color: 'neutral' },
  developing: { label: '开发中', color: 'info' },
  released: { label: '已发布', color: 'success' },
  archived: { label: '已归档', color: 'neutral' }
}

export function deliverableStatusBadge(status?: string | null): ProjectBadge {
  return deliverableStatusConfig[status || 'pending'] || { label: '未知状态', color: 'neutral' }
}

export function qualityStatusBadge(status?: string | null, deliverableStatus?: string | null): ProjectBadge {
  return qualityStatusConfig[status || 'not_submitted'] || deliverableStatusBadge(deliverableStatus)
}

export function deliverableTypeBadge(type?: string | null): ProjectBadge {
  return deliverableTypeConfig[type || ''] || { label: '其他类型', color: 'neutral' }
}

export function releaseStatusBadge(status?: string | null): ProjectBadge {
  return releaseStatusConfig[status || ''] || { label: '未知状态', color: 'neutral' }
}
