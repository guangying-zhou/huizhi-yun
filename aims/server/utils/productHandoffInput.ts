const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.isWellFormed() && [...value].length <= max && !value.includes('\0')

export function productHandoffInput(raw: unknown, itemId: string, requestId?: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !uuid.test(itemId)) return null
  if (requestId !== undefined && !uuid.test(requestId)) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(key => !['cycleBizId', 'expectedRevision', 'expectedItemRevision', 'expectedCycleRevision', 'expectedQueueRevision', 'requestBizId', 'expectedRequestRevision', 'projectCode', 'sliceKey', 'operation', 'requirementId', 'title', 'scopeSummary', 'reason', 'plannedVersionId', 'plannedVersionFeatureId'].includes(key))) return null
  const versionId = v.plannedVersionId ?? 0
  const featureId = v.plannedVersionFeatureId ?? 0
  const hasCycleGate = ['cycleBizId', 'expectedCycleRevision', 'expectedQueueRevision'].some(key => Object.hasOwn(v, key))
  const lightweight = positive(versionId) && positive(featureId) && !hasCycleGate
  if (![versionId, featureId].every(value => value === 0 || positive(value)) || (featureId !== 0 && versionId === 0)) return null
  if (lightweight) {
    if (![v.expectedRevision, v.expectedItemRevision].every(positive)) return null
  } else if (typeof v.cycleBizId !== 'string' || !uuid.test(v.cycleBizId) || ![v.expectedRevision, v.expectedItemRevision, v.expectedCycleRevision, v.expectedQueueRevision].every(positive)) return null
  const request = requestId ?? v.requestBizId ?? ''
  const requestRevision = v.expectedRequestRevision ?? 0
  if (requestId !== undefined && v.requestBizId !== undefined && v.requestBizId !== requestId) return null
  if (typeof request !== 'string' || (request ? !uuid.test(request) || !positive(requestRevision) : requestRevision !== 0)) return null
  for (const [value, max] of [[v.projectCode, 64], [v.sliceKey, 191]] as const) {
    if (!text(value, max) || value !== value.trim() || /[/\\\p{Cc}]/u.test(value)) return null
  }
  const requirementId = v.requirementId ?? 0
  const title = v.title ?? ''
  if (v.operation === 'create') {
    if (requirementId !== 0 || !text(title, 500)) return null
  } else if (v.operation === 'link') {
    if (!positive(requirementId) || title !== '') return null
  } else return null
  if (!text(v.scopeSummary, 2000) || !text(v.reason, 2000)) return null
  return {
    item_biz_id: itemId, cycle_biz_id: lightweight ? '' : v.cycleBizId,
    expected_revision: v.expectedRevision as number, expected_item_revision: v.expectedItemRevision as number,
    expected_cycle_revision: lightweight ? 0 : v.expectedCycleRevision as number, expected_queue_revision: lightweight ? 0 : v.expectedQueueRevision as number,
    request_biz_id: request, expected_request_revision: requestRevision as number,
    project_code: v.projectCode as string, slice_key: v.sliceKey as string, operation: v.operation,
    requirement_id: requirementId as number, title: title as string, scope_summary: v.scopeSummary, reason: v.reason,
    planned_version_id: versionId as number, planned_version_feature_id: featureId as number
  }
}
