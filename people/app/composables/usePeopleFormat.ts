import type { UiColor } from '~/types'

export function usePeopleFormat() {
  const statusLabels: Record<string, string> = {
    none: '无需审批',
    active: '在职',
    inactive: '停用',
    leaving: '离职中',
    left: '已离职',
    full_time: '全职',
    part_time: '兼职',
    outsourced: '外包/顾问',
    intern: '实习',
    agent: 'AI Agent',
    draft: '草稿',
    pending: '待审批',
    approved: '已确认',
    rejected: '已驳回',
    collecting: '采集中',
    calculating: '计算中',
    confirmed: '已确认',
    closed: '已关闭',
    onboard: '入职',
    transfer: '调岗',
    rank_change: '职级调整',
    leave: '离职',
    month: '月度',
    quarter: '季度',
    annual: '年度',
    project: '项目',
    team: '团队',
    org: '组织',
    standard_rate: '职级标准'
  }

  const statusColors: Record<string, UiColor> = {
    active: 'success',
    approved: 'success',
    confirmed: 'success',
    collecting: 'primary',
    calculating: 'warning',
    pending: 'warning',
    draft: 'neutral',
    inactive: 'neutral',
    left: 'neutral',
    rejected: 'error',
    closed: 'neutral',
    leave: 'error',
    transfer: 'primary',
    rank_change: 'secondary',
    onboard: 'success'
  }

  function label(value?: string | null) {
    if (!value) return '-'
    return statusLabels[value] || value
  }

  function color(value?: string | null): UiColor {
    if (!value) return 'neutral'
    return statusColors[value] || 'neutral'
  }

  function money(value?: number | string | null) {
    if (value === null || value === undefined || value === '') return '-'
    const amount = Number(value)
    if (Number.isNaN(amount)) return String(value)
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      maximumFractionDigits: 0
    }).format(amount)
  }

  function date(value?: string | null) {
    if (!value) return '-'
    const normalized = value.trim().slice(0, 10)
    if (!normalized || normalized === '0000-00-00' || normalized === '1970-01-01') return '-'
    return normalized
  }

  return {
    label,
    color,
    money,
    date
  }
}
