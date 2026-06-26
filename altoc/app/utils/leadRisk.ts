import type { Lead } from '~/types/altoc'

export type LeadRiskColor = 'error' | 'warning'

export interface LeadRisk {
  key: string
  label: string
  color: LeadRiskColor
  icon: string
}

const FOLLOW_UP_STALE_DAYS = 7
const NEW_LEAD_IDLE_DAYS = 3

function dateOnly(value: string | null | undefined) {
  if (!value) return null
  const text = String(value).trim()
  if (!text) return null
  const normalized = text.length <= 10 ? `${text}T00:00:00` : text.replace(' ', 'T')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return null
  date.setHours(0, 0, 0, 0)
  return date
}

function todayStart() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

function daysSince(value: string | null | undefined) {
  const date = dateOnly(value)
  if (!date) return null
  const diff = todayStart().getTime() - date.getTime()
  return Math.floor(diff / 86_400_000)
}

function isBeforeToday(value: string | null | undefined) {
  const date = dateOnly(value)
  return Boolean(date && date.getTime() < todayStart().getTime())
}

function isOpenLead(lead: Lead) {
  return lead.status !== 'converted' && lead.status !== 'closed_invalid'
}

export function getLeadRisks(lead: Lead): LeadRisk[] {
  if (!isOpenLead(lead)) return []

  const risks: LeadRisk[] = []
  const nextAction = String(lead.next_action || '').trim()
  if (!nextAction || !lead.next_action_due_at) {
    risks.push({
      key: 'no_next_action',
      label: '无下一步',
      color: 'warning',
      icon: 'i-lucide-list-todo'
    })
  } else if (isBeforeToday(lead.next_action_due_at)) {
    risks.push({
      key: 'next_action_overdue',
      label: '行动逾期',
      color: 'error',
      icon: 'i-lucide-clock-alert'
    })
  }

  const lastFollowUpDays = daysSince(lead.last_follow_up_at)
  if (lastFollowUpDays != null && lastFollowUpDays >= FOLLOW_UP_STALE_DAYS) {
    risks.push({
      key: 'follow_up_stale',
      label: '跟进超期',
      color: 'warning',
      icon: 'i-lucide-message-square-warning'
    })
  } else if (!lead.last_follow_up_at && (daysSince(lead.created_at) ?? 0) >= NEW_LEAD_IDLE_DAYS) {
    risks.push({
      key: 'never_followed',
      label: '未跟进',
      color: 'warning',
      icon: 'i-lucide-message-square-warning'
    })
  }

  return risks
}
