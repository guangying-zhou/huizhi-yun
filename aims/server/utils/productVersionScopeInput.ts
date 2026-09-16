import { productRequestPageInput } from './productRequestInput'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export function productVersionScopeInput(raw: unknown, versionId: number, allowDeferral = false) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Number.isSafeInteger(versionId) || versionId < 1) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(key => !['itemBizId', 'cycleBizId', 'expectedRevision', 'expectedItemRevision', 'expectedCycleRevision', 'expectedQueueRevision', 'expectedVersionRevision', 'title', 'description', 'acceptanceCriteria', 'changeType', 'reason', ...(allowDeferral ? ['deferredFrom'] : [])].includes(key))) return null
  if (![v.itemBizId, v.cycleBizId].every(value => typeof value === 'string' && uuid.test(value))) return null
  if (![v.expectedRevision, v.expectedItemRevision, v.expectedCycleRevision, v.expectedQueueRevision, v.expectedVersionRevision].every(value => Number.isSafeInteger(value) && Number(value) > 0)) return null
  for (const [value, max, required] of [[v.title, 255, true], [v.description ?? '', 10000, false], [v.acceptanceCriteria, 10000, true], [v.reason, 2000, true]] as const) {
    if (typeof value !== 'string' || !value.isWellFormed() || [...value].length > max || value.includes('\0') || (required && !value.trim())) return null
  }
  if (typeof v.changeType !== 'string' || !['new', 'enhancement', 'fix', 'retirement'].includes(v.changeType)) return null
  let deferredFrom: { version_id: number, scope_id: number, expected_version_revision: number, expected_scope_revision: number } | undefined
  if (Object.hasOwn(v, 'deferredFrom')) {
    if (!v.deferredFrom || typeof v.deferredFrom !== 'object' || Array.isArray(v.deferredFrom)) return null
    const source = v.deferredFrom as Record<string, unknown>
    const keys = ['versionId', 'scopeId', 'expectedVersionRevision', 'expectedScopeRevision']
    if (Object.keys(source).some(key => !keys.includes(key)) || !keys.every(key => Number.isSafeInteger(source[key]) && Number(source[key]) > 0) || source.versionId === versionId) return null
    deferredFrom = { version_id: source.versionId as number, scope_id: source.scopeId as number, expected_version_revision: source.expectedVersionRevision as number, expected_scope_revision: source.expectedScopeRevision as number }
  }
  return {
    ...(deferredFrom ? { deferred_from: deferredFrom } : {}),
    version_id: versionId, item_biz_id: v.itemBizId as string, cycle_biz_id: v.cycleBizId as string,
    expected_revision: v.expectedRevision as number, expected_item_revision: v.expectedItemRevision as number,
    expected_cycle_revision: v.expectedCycleRevision as number, expected_queue_revision: v.expectedQueueRevision as number, expected_version_revision: v.expectedVersionRevision as number,
    title: v.title as string, description: (v.description ?? '') as string, acceptance_criteria: v.acceptanceCriteria as string, change_type: v.changeType, reason: v.reason as string
  }
}
export function productVersionScopePageInput(raw: Record<string, unknown>) {
  if (Object.keys(raw).some(key => !['page', 'pageSize', 'keyword'].includes(key))) return null
  const q = productRequestPageInput(raw)
  return q ? { page: q.page, page_size: q.page_size, keyword: q.keyword } : null
}

export function productVersionScopeDeliveryInput(raw: unknown, versionID: number, scopeID: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![versionID, scopeID].every(id => Number.isSafeInteger(id) && id > 0)) return null
  const v = raw as Record<string, unknown>
  if (Object.keys(v).some(key => !['expectedRevision', 'expectedVersionRevision', 'expectedScopeRevision', 'evidence', 'reason'].includes(key))) return null
  if (![v.expectedRevision, v.expectedVersionRevision, v.expectedScopeRevision].every(value => Number.isSafeInteger(value) && Number(value) > 0)) return null
  for (const [value, max] of [[v.evidence, 10000], [v.reason, 2000]] as const) if (typeof value !== 'string' || !value.trim() || !value.isWellFormed() || [...value].length > max || value.includes('\0')) return null
  return { version_id: versionID, scope_id: scopeID, expected_revision: v.expectedRevision as number, expected_version_revision: v.expectedVersionRevision as number, expected_scope_revision: v.expectedScopeRevision as number, evidence: v.evidence as string, reason: v.reason as string }
}
