import type { UiColor } from '~/types'

export function usePeopleFormat() {
  const statusLabels: Record<string, string> = {
    active: '在职',
    inactive: '停用',
    leaving: '离职中',
    left: '已离职',
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
    leave: '离职'
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
    return value.slice(0, 10)
  }

  return {
    label,
    color,
    money,
    date
  }
}
