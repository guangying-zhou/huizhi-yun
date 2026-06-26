import type { Lead } from '~/types/altoc'

export type LeadScoreColor = 'success' | 'primary' | 'warning' | 'error'

export interface LeadScoreSignal {
  key: string
  label: string
  ok: boolean
  weight: number
}

function hasText(value: string | null | undefined) {
  return Boolean(String(value || '').trim())
}

function hasPositiveAmount(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function getLeadScoreSignals(lead: Lead): LeadScoreSignal[] {
  return [
    {
      key: 'customer',
      label: '客户对象',
      ok: hasText(lead.org_name) || hasText(lead.name),
      weight: 15
    },
    {
      key: 'need',
      label: '需求摘要',
      ok: hasText(lead.need_summary),
      weight: 20
    },
    {
      key: 'contact_or_evidence',
      label: '联系人/证据',
      ok: hasText(lead.contact_name) || hasText(lead.contact_mobile) || hasText(lead.contact_email) || hasText(lead.source_evidence_url),
      weight: 15
    },
    {
      key: 'owner',
      label: '负责人',
      ok: hasText(lead.owner_user_id),
      weight: 10
    },
    {
      key: 'next_action',
      label: '下一步',
      ok: hasText(lead.next_action) && hasText(lead.next_action_due_at),
      weight: 10
    },
    {
      key: 'budget',
      label: '预算信号',
      ok: hasPositiveAmount(lead.estimated_budget) || ['applying', 'approved', 'allocated'].includes(String(lead.budget_status || '')),
      weight: 10
    },
    {
      key: 'procurement',
      label: '采购计划',
      ok: hasText(lead.procurement_mode) || hasText(lead.expected_procurement_date),
      weight: 10
    },
    {
      key: 'source',
      label: '来源可信度',
      ok: hasText(lead.source_type) || hasText(lead.source_evidence_url),
      weight: 10
    }
  ]
}

export function getLeadRuleScore(lead: Lead) {
  if (lead.status === 'closed_invalid') return 0
  const score = getLeadScoreSignals(lead)
    .filter(signal => signal.ok)
    .reduce((sum, signal) => sum + signal.weight, 0)
  return Math.max(0, Math.min(100, score))
}

export function getLeadScoreColor(score: number): LeadScoreColor {
  if (score >= 80) return 'success'
  if (score >= 60) return 'primary'
  if (score >= 40) return 'warning'
  return 'error'
}
