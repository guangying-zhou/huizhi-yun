export function productRequestCreateInput(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['expectedRevision', 'title', 'problemStatement', 'sourceType', 'urgencyLevel', 'componentId'].includes(key))) return null
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1) return null
  for (const [key, limit] of [['title', 500], ['problemStatement', 10000]] as const) {
    const text = value[key]
    if (typeof text !== 'string' || !text.trim() || [...text].length > limit || text.includes('\0') || !text.isWellFormed()) return null
  }
  const source = value.sourceType === undefined ? 'internal' : value.sourceType
  const urgency = value.urgencyLevel === undefined ? 'P2' : value.urgencyLevel
  if (typeof source !== 'string' || !['customer', 'internal', 'engineering', 'other'].includes(source)
    || typeof urgency !== 'string' || !['P0', 'P1', 'P2', 'P3'].includes(urgency)) return null
  if (Object.hasOwn(value, 'componentId') && value.componentId !== null && (!Number.isSafeInteger(value.componentId) || Number(value.componentId) < 1)) return null
  return {
    expected_revision: Number(value.expectedRevision), title: value.title as string,
    problem_statement: value.problemStatement as string, source_type: source, urgency_level: urgency,
    ...(Object.hasOwn(value, 'componentId') ? { component_id: value.componentId === null ? null : Number(value.componentId) } : {})
  }
}

export function productRequestPageInput(raw: Record<string, unknown>) {
  if (Object.keys(raw).some(key => !['page', 'pageSize', 'keyword', 'decisionStatus', 'sourceType', 'urgencyLevel', 'mergedInto', 'componentId', 'unassigned', 'includeDescendants'].includes(key))) return null
  const number = (value: unknown, fallback: number) => value === undefined ? fallback : typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN
  const page = number(raw.page, 1), pageSize = number(raw.pageSize, 20)
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) return null
  const keyword = raw.keyword === undefined ? '' : raw.keyword
  if (typeof keyword !== 'string' || [...keyword].length > 200 || keyword.includes('\0') || !keyword.isWellFormed()) return null
  const status = raw.decisionStatus === undefined ? '' : raw.decisionStatus
  const source = raw.sourceType === undefined ? '' : raw.sourceType
  const urgency = raw.urgencyLevel === undefined ? '' : raw.urgencyLevel
  if (typeof status !== 'string' || !['', 'submitted', 'evaluating', 'accepted', 'deferred', 'rejected', 'merged'].includes(status)
    || typeof source !== 'string' || !['', 'customer', 'internal', 'engineering', 'other'].includes(source)
    || typeof urgency !== 'string' || !['', 'P0', 'P1', 'P2', 'P3'].includes(urgency)) return null
  const mergedInto = raw.mergedInto
  if (mergedInto !== undefined && (typeof mergedInto !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(mergedInto))) return null
  const bool = (value: unknown) => value === undefined
    ? false
    : value === 'true'
      ? true
      : value === 'false' ? false : null
  const componentID = raw.componentId === undefined
    ? undefined
    : typeof raw.componentId === 'string' && /^[1-9]\d*$/.test(raw.componentId) && Number.isSafeInteger(Number(raw.componentId)) ? Number(raw.componentId) : null
  const unassigned = bool(raw.unassigned), includeDescendants = bool(raw.includeDescendants)
  if (componentID === null || unassigned === null || includeDescendants === null || (unassigned && componentID !== undefined) || (includeDescendants && componentID === undefined)) return null
  return { page, page_size: pageSize, keyword, decision_status: status, source_type: source, urgency_level: urgency,
    ...(mergedInto === undefined ? {} : { merged_into_biz_id: mergedInto as string }),
    ...(componentID === undefined ? {} : { component_id: componentID }), unassigned, include_descendants: includeDescendants }
}

export function productRequestEditInput(raw: unknown, bizId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bizId)) return null
  const { expectedRequestRevision, reason, componentId, ...draft } = raw as Record<string, unknown>
  const input = draft.sourceType === undefined || draft.urgencyLevel === undefined ? null : productRequestCreateInput(draft)
  if (!input || !Number.isSafeInteger(expectedRequestRevision) || Number(expectedRequestRevision) < 1
    || typeof reason !== 'string' || !reason.trim() || [...reason].length > 2000 || reason.includes('\0') || !reason.isWellFormed()) return null
  if (Object.hasOwn(raw, 'componentId') && componentId !== null && (!Number.isSafeInteger(componentId) || Number(componentId) < 1)) return null
  return { ...input, biz_id: bizId, expected_request_revision: Number(expectedRequestRevision), reason,
    ...(Object.hasOwn(raw, 'componentId') ? { component_id: componentId === null ? 0 : Number(componentId) } : {}) }
}

export function productRequestDecisionInput(raw: unknown, bizId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bizId)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['expectedRevision', 'expectedRequestRevision', 'status', 'reason', 'impactNote'].includes(key))) return null
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1 || !Number.isSafeInteger(value.expectedRequestRevision) || Number(value.expectedRequestRevision) < 1) return null
  if (typeof value.status !== 'string' || !['evaluating', 'accepted', 'deferred', 'rejected'].includes(value.status)) return null
  const reason = value.reason === undefined ? '' : value.reason
  const impact = value.impactNote === undefined ? '' : value.impactNote
  for (const text of [reason, impact]) {
    if (typeof text !== 'string' || [...text].length > 2000 || text.includes('\0') || !text.isWellFormed()) return null
  }
  // State-dependent reason/impact requirements are checked under the root lock.
  return { biz_id: bizId, expected_revision: Number(value.expectedRevision), expected_request_revision: Number(value.expectedRequestRevision), status: value.status, reason: reason as string, impact_note: impact as string }
}

export function productRequestMergeInput(raw: unknown, bizId: string) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !uuid.test(bizId)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['expectedRevision', 'expectedRequestRevision', 'expectedTargetRevision', 'targetBizId', 'reason', 'impactNote'].includes(key))) return null
  if (typeof value.targetBizId !== 'string' || !uuid.test(value.targetBizId) || value.targetBizId === bizId) return null
  for (const key of ['expectedRevision', 'expectedRequestRevision', 'expectedTargetRevision']) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 1) return null
  }
  const impact = value.impactNote === undefined ? '' : value.impactNote
  if (typeof value.reason !== 'string' || !value.reason.trim()) return null
  for (const text of [value.reason, impact]) {
    if (typeof text !== 'string' || [...text].length > 2000 || text.includes('\0') || !text.isWellFormed()) return null
  }
  return { biz_id: bizId, target_biz_id: value.targetBizId, expected_revision: Number(value.expectedRevision), expected_request_revision: Number(value.expectedRequestRevision), expected_target_revision: Number(value.expectedTargetRevision), reason: value.reason, impact_note: impact as string }
}
