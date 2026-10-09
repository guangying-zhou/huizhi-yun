// 项目需求列表的既有展示词表；独立 Aims 与 Enterprise Host 共用。
export const statusLabel: Record<string, string> = {
  draft: '草稿',
  in_review: '评审中',
  baselined: '已基线',
  change_pending: '变更中',
  deprecated: '已废弃'
}

export const statusColor: Record<string, 'neutral' | 'warning' | 'success' | 'info' | 'error'> = {
  draft: 'neutral',
  in_review: 'warning',
  baselined: 'success',
  change_pending: 'info',
  deprecated: 'error'
}

export const typeLabel: Record<string, string> = {
  functional: '功能',
  non_functional: '非功能'
}

export const priorityColor: Record<string, 'error' | 'warning' | 'info' | 'neutral'> = {
  P0: 'error',
  P1: 'warning',
  P2: 'info',
  P3: 'neutral'
}

export const sourceLabel: Record<string, string> = {
  customer: '客户',
  internal: '内部',
  compliance: '合规',
  regulation: '法规',
  other: '其他'
}
