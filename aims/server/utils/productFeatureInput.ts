import { productVersionID } from './productVersionInput.ts'
import { productRequestPageInput } from './productRequestInput.ts'

export function productFeatureCreateInput(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['expectedRevision', 'title', 'description'].includes(key))) return null
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1) return null
  if (typeof value.title !== 'string' || !value.title.trim()) return null
  const description = value.description === undefined ? '' : value.description
  for (const [text, max] of [[value.title, 500], [description, 10000]] as const) {
    if (typeof text !== 'string' || [...text].length > max || text.includes('\0') || !text.isWellFormed()) return null
  }
  return { expected_revision: Number(value.expectedRevision), title: value.title, description: description as string }
}

export function productFeaturePageInput(raw: Record<string, unknown>) {
  if (Object.keys(raw).some(key => !['page', 'pageSize', 'keyword', 'lifecycle', 'componentId', 'ungrouped'].includes(key))) return null
  const componentID = raw.componentId === undefined ? null : productVersionID(raw.componentId)
  if ((raw.componentId !== undefined && componentID === null) || (raw.ungrouped !== undefined && raw.ungrouped !== 'true') || (raw.componentId !== undefined && raw.ungrouped !== undefined)) return null
  const lifecycle = raw.lifecycle === undefined ? '' : raw.lifecycle
  if (typeof lifecycle !== 'string' || !['', 'candidate', 'active', 'deprecated'].includes(lifecycle)) return null
  const page = productRequestPageInput({ page: raw.page, pageSize: raw.pageSize, keyword: raw.keyword })
  return page ? { page: page.page, page_size: page.page_size, keyword: page.keyword, lifecycle, ...(componentID === null ? {} : { component_id: componentID }), ...(raw.ungrouped === 'true' ? { ungrouped: true } : {}) } : null
}

export function productFeatureEditInput(raw: unknown, bizId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bizId)) return null
  const { expectedFeatureRevision, reason, ...draft } = raw as Record<string, unknown>
  const input = productFeatureCreateInput(draft)
  if (!input || !Number.isSafeInteger(expectedFeatureRevision) || Number(expectedFeatureRevision) < 1 || typeof reason !== 'string' || !reason.trim() || [...reason].length > 2000 || reason.includes('\0') || !reason.isWellFormed()) return null
  return { ...input, biz_id: bizId, expected_feature_revision: Number(expectedFeatureRevision), reason }
}

export function productFeatureDeleteInput(raw: unknown, bizId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bizId)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['expectedRevision', 'expectedFeatureRevision', 'reason'].includes(key))) return null
  for (const key of ['expectedRevision', 'expectedFeatureRevision']) if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 1) return null
  if (typeof value.reason !== 'string' || !value.reason.trim() || [...value.reason].length > 2000 || value.reason.includes('\0') || !value.reason.isWellFormed()) return null
  return { biz_id: bizId, expected_revision: Number(value.expectedRevision), expected_feature_revision: Number(value.expectedFeatureRevision), reason: value.reason }
}

export function productFeatureComponentInput(raw: unknown, bizID: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bizID)) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(key => !['componentId', 'expectedRevision', 'expectedFeatureRevision', 'reason'].includes(key)) || !Object.hasOwn(v, 'componentId')) return null
  if (v.componentId !== null && (!Number.isSafeInteger(v.componentId) || Number(v.componentId) < 1)) return null
  if (![v.expectedRevision, v.expectedFeatureRevision].every(value => Number.isSafeInteger(value) && Number(value) > 0) || typeof v.reason !== 'string' || !v.reason.trim() || !v.reason.isWellFormed() || [...v.reason].length > 2000 || v.reason.includes('\0')) return null
  return { biz_id: bizID, component_id: v.componentId as number | null, expected_revision: Number(v.expectedRevision), expected_feature_revision: Number(v.expectedFeatureRevision), reason: v.reason }
}
