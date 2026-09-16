export function productPlanningCyclePageInput(raw: Record<string, unknown>) {
  if (Object.keys(raw).some(key => !['page', 'pageSize', 'keyword', 'status', 'reviewDue'].includes(key))) return null
  const number = (value: unknown, fallback: number) => value === undefined ? fallback : typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : NaN
  const page = number(raw.page, 1), pageSize = number(raw.pageSize, 20)
  const keyword = raw.keyword === undefined ? '' : raw.keyword
  const status = raw.status === undefined ? '' : raw.status
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) return null
  if (typeof keyword !== 'string' || !keyword.isWellFormed() || [...keyword].length > 200 || keyword.includes('\0')) return null
  if (typeof status !== 'string' || !['', 'draft', 'open', 'closed'].includes(status)) return null
  if (raw.reviewDue !== undefined && raw.reviewDue !== 'true' && raw.reviewDue !== 'false') return null
  return { page, page_size: pageSize, keyword, status, ...(raw.reviewDue === 'true' ? { review_due: true } : {}) }
}

const cycleText = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.isWellFormed() && [...value].length <= max && !value.includes('\0')
const cycleDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
// Return integer hundredths for validation; send exact decimal strings to Go.
const cycleAmount = (value: unknown) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value)
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) return null
  const [whole = '', fraction = ''] = text.split('.')
  const units = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(units) && units <= 100000000 ? units : null
}

export function productPlanningCycleCreateInput(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['expectedRevision', 'title', 'startsOn', 'endsOn', 'goalSummary', 'reviewIntervalDays', 'budget', 'metric'].includes(key))) return null
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1 || !cycleText(value.title, 255) || !cycleText(value.goalSummary, 10000)) return null
  if (!cycleDate(value.startsOn) || !cycleDate(value.endsOn) || value.endsOn < value.startsOn) return null
  const interval = value.reviewIntervalDays === undefined ? 14 : value.reviewIntervalDays
  if (!Number.isSafeInteger(interval) || Number(interval) < 1 || Number(interval) > 366) return null
  let budget: Record<string, string> | null = null
  if (value.budget !== undefined && value.budget !== null) {
    budget = productPlanningBudgetInput(value.budget)
    if (!budget) return null
  }
  const metric = value.metric === undefined || value.metric === null ? null : productPlanningCycleMetricInput(value.metric)
  if (value.metric !== undefined && value.metric !== null && !metric) return null
  return { expected_revision: Number(value.expectedRevision), title: value.title, starts_on: value.startsOn, ends_on: value.endsOn, goal_summary: value.goalSummary, review_interval_days: Number(interval), budget, metric }
}

export function productPlanningCycleEditInput(raw: unknown, bizId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bizId)) return null
  const { expectedCycleRevision, reason, budgetMode, ...draft } = raw as Record<string, unknown>
  if (!Number.isSafeInteger(expectedCycleRevision) || Number(expectedCycleRevision) < 1 || !cycleText(reason, 2000)) return null
  if (typeof budgetMode !== 'string' || !['keep', 'set', 'clear'].includes(budgetMode)) return null
  // Editing must not apply creation defaults to a missing review interval.
  if (draft.reviewIntervalDays === undefined) return null
  if (budgetMode === 'set' ? draft.budget === undefined || draft.budget === null : draft.budget !== undefined && draft.budget !== null) return null
  const input = productPlanningCycleCreateInput(draft)
  if (!input) return null
  return { ...input, biz_id: bizId, expected_cycle_revision: Number(expectedCycleRevision), reason, budget_mode: budgetMode }
}

export function productPlanningCycleMetricInput(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['name', 'unit', 'direction', 'measurementMethod', 'baselineValue', 'targetValue'].includes(key))) return null
  if (!cycleText(value.name, 255) || !cycleText(value.unit, 64) || !cycleText(value.measurementMethod, 2000) || typeof value.direction !== 'string' || !['increase', 'decrease', 'maintain'].includes(value.direction)) return null
  // Both keys are explicit: omitted values must not clear an existing metric.
  if (!Object.hasOwn(value, 'baselineValue') || !Object.hasOwn(value, 'targetValue')) return null
  const validDecimal = (input: unknown) => input === null || (typeof input === 'string' && /^-?\d{1,14}(?:\.\d{1,6})?$/.test(input))
  if (!validDecimal(value.baselineValue) || !validDecimal(value.targetValue)) return null
  return { name: value.name, unit: value.unit, direction: value.direction, measurement_method: value.measurementMethod, baseline_value: value.baselineValue as string | null, target_value: value.targetValue as string | null }
}

export function productPlanningCycleTransitionInput(raw: unknown, bizId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bizId)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['expectedRevision', 'expectedCycleRevision', 'reason'].includes(key))) return null
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1 || !Number.isSafeInteger(value.expectedCycleRevision) || Number(value.expectedCycleRevision) < 1 || !cycleText(value.reason, 2000)) return null
  return { biz_id: bizId, expected_revision: Number(value.expectedRevision), expected_cycle_revision: Number(value.expectedCycleRevision), reason: value.reason }
}

export function productPlanningCandidatePageInput(raw: Record<string, unknown>, cycleId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cycleId)) return null
  if (Object.keys(raw).some(key => !['page', 'pageSize', 'keyword', 'selectionStatus', 'sort', 'investmentCategory'].includes(key))) return null
  const { selectionStatus, sort, investmentCategory, ...pagination } = raw
  const page = productPlanningCyclePageInput(pagination)
  const selection = selectionStatus === undefined ? '' : selectionStatus
  if (!page || typeof selection !== 'string' || !['', 'candidate', 'selected', 'deferred'].includes(selection)) return null
  if (sort !== undefined && (typeof sort !== 'string' || !['decision', 'recommended'].includes(sort))) return null
  if (investmentCategory !== undefined && (typeof investmentCategory !== 'string' || !['reliability', 'usability', 'growth'].includes(investmentCategory))) return null
  return { cycle_biz_id: cycleId, page: page.page, page_size: page.page_size, keyword: page.keyword, selection_status: selection, ...(sort === undefined ? {} : { sort }), ...(investmentCategory === undefined ? {} : { investment_category: investmentCategory }) }
}

export function productPlanningCandidateAddInput(raw: unknown, cycleId: string) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  if (!uuid.test(cycleId) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(key => !['itemId', 'expectedRevision', 'expectedCycleRevision', 'expectedItemRevision'].includes(key))) return null
  if (typeof value.itemId !== 'string' || !uuid.test(value.itemId)) return null
  for (const key of ['expectedRevision', 'expectedCycleRevision', 'expectedItemRevision']) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 1) return null
  }
  return { cycle_biz_id: cycleId, item_biz_id: value.itemId, expected_revision: Number(value.expectedRevision), expected_cycle_revision: Number(value.expectedCycleRevision), expected_item_revision: Number(value.expectedItemRevision) }
}

export function productPlanningMatrixInput(raw: Record<string, unknown>, cycleId: string) {
  if (Object.keys(raw).some(key => !['keyword', 'selectionStatus', 'investmentCategory'].includes(key))) return null
  const parsed = productPlanningCandidatePageInput(raw, cycleId)
  if (!parsed) return null
  return { cycle_biz_id: parsed.cycle_biz_id, keyword: parsed.keyword, selection_status: parsed.selection_status, investment_category: parsed.investment_category || '' }
}

export function productPlanningCapacityInput(raw: Record<string, unknown>, cycleId: string) {
  if (Object.keys(raw).length) return null
  const parsed = productPlanningCandidatePageInput({}, cycleId)
  return parsed ? { cycle_biz_id: parsed.cycle_biz_id } : null
}

export function productPlanningBudgetInput(raw: unknown) {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const fields = ['totalPersonDays', 'reservePersonDays', 'reliabilityPersonDays', 'usabilityPersonDays', 'growthPersonDays']
  const keys = ['total_person_days', 'reserve_person_days', 'reliability_person_days', 'usability_person_days', 'growth_person_days']
  if (Object.keys(source).some(key => !fields.includes(key))) return null
  const amounts = fields.map(key => cycleAmount(source[key]))
  if (amounts.some(amount => amount === null)) return null
  const units = amounts as number[]
  if (units.slice(1).reduce((sum, amount) => sum + amount, 0) > units[0]!) return null
  return Object.fromEntries(keys.map((key, index) => {
    const amount = units[index]!
    return [key, `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`]
  }))
}
