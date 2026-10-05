import type { Opportunity } from '~/types/altoc'

export type OpportunityRiskColor = 'error' | 'warning' | 'neutral'

export interface OpportunityRisk {
  key: string
  label: string
  color: OpportunityRiskColor
  icon: string
}

const FOLLOW_UP_STALE_DAYS = 14
const NEW_OPPORTUNITY_IDLE_DAYS = 3

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

function isOpenOpportunity(opp: Opportunity) {
  return opp.status === 'active' || opp.status === 'paused'
}

export function getOpportunityRisks(opp: Opportunity): OpportunityRisk[] {
  if (!isOpenOpportunity(opp)) return []

  const risks: OpportunityRisk[] = []
  const nextAction = String(opp.next_action || '').trim()
  if (!nextAction || !opp.next_action_due_at) {
    risks.push({
      key: 'no_next_action',
      label: '无下一步',
      color: 'warning',
      icon: 'i-lucide-list-todo'
    })
  } else if (isBeforeToday(opp.next_action_due_at)) {
    risks.push({
      key: 'next_action_overdue',
      label: '行动逾期',
      color: 'error',
      icon: 'i-lucide-clock-alert'
    })
  }

  if (opp.expected_sign_date && isBeforeToday(opp.expected_sign_date)) {
    risks.push({
      key: 'sign_date_overdue',
      label: '签约逾期',
      color: 'error',
      icon: 'i-lucide-calendar-clock'
    })
  }

  const lastFollowUpDays = daysSince(opp.last_follow_up_at)
  if (lastFollowUpDays != null && lastFollowUpDays >= FOLLOW_UP_STALE_DAYS) {
    risks.push({
      key: 'follow_up_stale',
      label: '跟进超期',
      color: 'warning',
      icon: 'i-lucide-message-square-warning'
    })
  } else if (!opp.last_follow_up_at && (daysSince(opp.created_at) ?? 0) >= NEW_OPPORTUNITY_IDLE_DAYS) {
    risks.push({
      key: 'never_followed',
      label: '未跟进',
      color: 'warning',
      icon: 'i-lucide-message-square-warning'
    })
  }

  return risks
}
