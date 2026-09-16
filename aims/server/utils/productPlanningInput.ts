const categories = ['reliability', 'usability', 'growth']
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const revision = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0
const validText = (value: unknown, max: number, required = true): value is string => typeof value === 'string' && (!required || !!value.trim()) && [...value].length <= max && value.isWellFormed() && !value.includes('\0')

export function productPlanningCreateInput(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['expectedRevision', 'title', 'scopeSummary', 'investmentCategory', 'urgencyLevel', 'requests'].includes(key))) return null
  if (!revision(value.expectedRevision) || !validText(value.title, 500) || !validText(value.scopeSummary, 10000) || typeof value.investmentCategory !== 'string' || !categories.includes(value.investmentCategory)) return null
  const urgency = value.urgencyLevel === undefined ? 'P2' : value.urgencyLevel
  if (typeof urgency !== 'string' || !['P0', 'P1', 'P2', 'P3'].includes(urgency)) return null
  const rawRequests = value.requests === undefined ? [] : value.requests
  if (!Array.isArray(rawRequests) || rawRequests.length > 100) return null
  const requests: { biz_id: string, revision: number }[] = []
  const seen = new Set<string>()
  for (const source of rawRequests) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null
    if (Object.keys(source).some(key => !['bizId', 'revision'].includes(key)) || typeof source.bizId !== 'string' || !uuid.test(source.bizId) || !revision(source.revision) || seen.has(source.bizId)) return null
    seen.add(source.bizId)
    requests.push({ biz_id: source.bizId, revision: source.revision })
  }
  return { expected_revision: Number(value.expectedRevision), title: value.title, scope_summary: value.scopeSummary, investment_category: value.investmentCategory, urgency_level: urgency, requests }
}

export function productPlanningPageInput(raw: Record<string, unknown>) {
  if (Object.keys(raw).some(key => !['page', 'pageSize', 'keyword', 'lifecycle', 'investmentCategory'].includes(key))) return null
  const number = (value: unknown, fallback: number) => value === undefined ? fallback : typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN
  const page = number(raw.page, 1), pageSize = number(raw.pageSize, 20)
  const keyword = raw.keyword === undefined ? '' : raw.keyword
  const lifecycle = raw.lifecycle === undefined ? '' : raw.lifecycle
  const category = raw.investmentCategory === undefined ? '' : raw.investmentCategory
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || !validText(keyword, 200, false)) return null
  if (typeof lifecycle !== 'string' || !['', 'proposed', 'in_delivery', 'delivered', 'cancelled', 'merged'].includes(lifecycle) || typeof category !== 'string' || !['', ...categories].includes(category)) return null
  return { page, page_size: pageSize, keyword, lifecycle, investment_category: category }
}

export function productPlanningEditInput(raw: unknown, bizId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !uuid.test(bizId)) return null
  const { expectedItemRevision, reason, impactNote, ...draft } = raw as Record<string, unknown>
  // Editing replaces the explicit source set; omission must not clear sources.
  if (!Array.isArray(draft.requests) || draft.urgencyLevel === undefined) return null
  const input = productPlanningCreateInput(draft)
  if (!input || !revision(expectedItemRevision) || !validText(reason, 2000)) return null
  const impact = impactNote === undefined ? '' : impactNote
  if (!validText(impact, 2000, false)) return null
  return { ...input, biz_id: bizId, expected_item_revision: Number(expectedItemRevision), reason, impact_note: impact }
}
