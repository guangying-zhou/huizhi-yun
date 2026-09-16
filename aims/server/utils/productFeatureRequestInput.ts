import { productRequestPageInput } from './productRequestInput'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function productFeatureRequestPageInput(raw: Record<string, unknown>, featureId: string) {
  if (!uuid.test(featureId) || Object.keys(raw).some(key => !['page', 'pageSize'].includes(key))) return null
  const page = productRequestPageInput(raw)
  return page ? { feature_biz_id: featureId, page: page.page, page_size: page.page_size } : null
}

export function productFeatureRequestChangeInput(raw: unknown, featureId: string) {
  if (!uuid.test(featureId) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['requestBizId', 'expectedRevision', 'expectedFeatureRevision', 'expectedRequestRevision', 'operation', 'reason'].includes(key))) return null
  if (typeof value.requestBizId !== 'string' || !uuid.test(value.requestBizId)) return null
  for (const key of ['expectedRevision', 'expectedFeatureRevision', 'expectedRequestRevision']) if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 1) return null
  if (value.operation !== 'link' && value.operation !== 'unlink') return null
  if (typeof value.reason !== 'string' || !value.reason.trim() || [...value.reason].length > 2000 || value.reason.includes('\0') || !value.reason.isWellFormed()) return null
  return { feature_biz_id: featureId, request_biz_id: value.requestBizId, expected_revision: Number(value.expectedRevision), expected_feature_revision: Number(value.expectedFeatureRevision), expected_request_revision: Number(value.expectedRequestRevision), operation: value.operation, reason: value.reason }
}
