import type { Opportunity, OpportunityStage } from '~/types/altoc'
import { opportunityStageRuntimeStatus } from '~/utils/opportunityStages'

export const OPPORTUNITY_STAGE_REQUIREMENT_LABELS: Record<string, string> = {
  customer_id: '所属客户',
  amount_tax_inclusive: '预计/最终金额',
  expected_sign_date: '预计/签约日期',
  competitor_info: '竞品信息',
  next_action: '下一步动作',
  next_action_due_at: '下一步截止日期',
  won_reason_code: '赢单原因',
  won_reason: '赢单说明',
  lost_reason_code: '输单原因',
  lost_reason: '输单说明',
  pause_reason_code: '暂停原因',
  pause_reason: '暂停说明'
}

const EDITABLE_STAGE_REQUIREMENT_FIELDS = new Set([
  'amount_tax_inclusive',
  'expected_sign_date',
  'competitor_info',
  'next_action',
  'next_action_due_at'
])

function normalizeFieldName(value: unknown) {
  const field = String(value ?? '').trim()
  return field && field !== '<nil>' ? field : ''
}

function fieldsFromValue(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) {
    return value.map(normalizeFieldName).filter(Boolean)
  }
  if (typeof value === 'object') {
    const config = value as Record<string, unknown>
    return fieldsFromValue(config.fields ?? config.required_fields ?? config.requiredFields)
  }
  const text = normalizeFieldName(value)
  if (!text) return []
  try {
    return fieldsFromValue(JSON.parse(text))
  } catch {
    return []
  }
}

function valuePresent(value: unknown) {
  if (value == null) return false
  const text = String(value).trim()
  return text !== '' && text !== '<nil>'
}

function fieldValue(opportunity: Opportunity | null | undefined, overrides: Record<string, unknown>, field: string) {
  if (Object.prototype.hasOwnProperty.call(overrides, field)) {
    return overrides[field]
  }
  if (!opportunity) return undefined
  return (opportunity as unknown as Record<string, unknown>)[field]
}

export function parseOpportunityStageRequiredFields(stage: Pick<OpportunityStage, 'required_fields_json'> | null | undefined) {
  return fieldsFromValue(stage?.required_fields_json)
}

export function parseOpportunityStageExitFields(stage: Pick<OpportunityStage, 'exit_criteria_json'> | null | undefined) {
  return fieldsFromValue(stage?.exit_criteria_json)
}

export function getOpportunityStageMissingFields(
  stage: Pick<OpportunityStage, 'required_fields_json'> | null | undefined,
  opportunity: Opportunity | null | undefined,
  overrides: Record<string, unknown> = {}
) {
  return parseOpportunityStageRequiredFields(stage).filter(field => !valuePresent(fieldValue(opportunity, overrides, field)))
}

export function getOpportunityTransitionMissingFields(
  currentStage: OpportunityStage | null | undefined,
  targetStage: OpportunityStage | null | undefined,
  opportunity: Opportunity | null | undefined,
  overrides: Record<string, unknown> = {}
) {
  const missing = new Set<string>()
  if (
    currentStage
    && targetStage
    && Number(currentStage.id) !== Number(targetStage.id)
    && opportunityStageRuntimeStatus(targetStage) === 'active'
  ) {
    for (const field of parseOpportunityStageExitFields(currentStage)) {
      if (!valuePresent(fieldValue(opportunity, overrides, field))) {
        missing.add(field)
      }
    }
  }
  for (const field of getOpportunityStageMissingFields(targetStage, opportunity, overrides)) {
    missing.add(field)
  }
  return [...missing]
}

export function expandOpportunityStageRequirementFields(
  fields: string[],
  opportunity: Opportunity | null | undefined,
  overrides: Record<string, unknown> = {}
) {
  const expanded = new Set(fields)
  if (expanded.has('next_action') && !valuePresent(fieldValue(opportunity, overrides, 'next_action_due_at'))) {
    expanded.add('next_action_due_at')
  }
  if (expanded.has('next_action_due_at') && !valuePresent(fieldValue(opportunity, overrides, 'next_action'))) {
    expanded.add('next_action')
  }
  return [...expanded]
}

export function isEditableOpportunityStageRequirement(field: string) {
  return EDITABLE_STAGE_REQUIREMENT_FIELDS.has(field)
}

export function opportunityStageRequirementLabel(field: string) {
  return OPPORTUNITY_STAGE_REQUIREMENT_LABELS[field] || field
}
