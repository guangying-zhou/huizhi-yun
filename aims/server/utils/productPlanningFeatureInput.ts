import { productFeatureRequestChangeInput } from './productFeatureRequestInput'

export function productPlanningFeatureInput(raw: unknown, itemId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['featureBizId', 'expectedRevision', 'expectedItemRevision', 'expectedFeatureRevision', 'operation', 'reason', 'impactNote'].includes(key)) || typeof value.featureBizId !== 'string') return null
  const input = productFeatureRequestChangeInput({ requestBizId: itemId, expectedRevision: value.expectedRevision, expectedRequestRevision: value.expectedItemRevision, expectedFeatureRevision: value.expectedFeatureRevision, operation: value.operation, reason: value.reason }, value.featureBizId)
  const impact = value.impactNote === undefined ? '' : value.impactNote
  if (!input || typeof impact !== 'string' || [...impact].length > 2000 || impact.includes('\0') || !impact.isWellFormed()) return null
  return { item_biz_id: input.request_biz_id, feature_biz_id: input.feature_biz_id, expected_revision: input.expected_revision, expected_item_revision: input.expected_request_revision, expected_feature_revision: input.expected_feature_revision, operation: input.operation, reason: input.reason, impact_note: impact }
}
