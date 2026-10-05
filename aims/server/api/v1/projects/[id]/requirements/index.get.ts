/**
 * 获取需求项列表（支持筛选/分页/排序）
 * GET /api/v1/projects/:id/requirements
 * Query: type, status, priority, milestone_id, source, search, page, pageSize, sort, order
 */
import { listAllAimsRuntime, nullableNumberValue, numberValue, stringValue } from '~~/server/utils/aimsRuntimePages'

interface RuntimeRequirement {
  id?: number
  item_kind?: string
  parent_requirement_id?: number | null
  change_no?: number | null
  change_reason?: string | null
  scope_note?: string | null
  req_number?: number
  req_code?: string
  title?: string
  type?: string
  category?: string | null
  priority?: string
  source?: string
  milestone_id?: number | null
  status?: string
  current_version?: number
  baselined_at?: string | null
  created_by?: string
  created_at?: string
  updated_at?: string
  work_item_id?: number | null
}

interface RuntimeMilestone {
  id?: number
  name?: string
}

interface RuntimeWorkItem {
  item_key?: string
  status?: string
  type?: string
  requirement_id?: number | null
}

interface RuntimeReviewBatch {
  batch_type?: string
  status?: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const projectId = Number(getRouterParam(event, 'id'))
  if (!projectId || Number.isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const query = getQuery(event) as Record<string, unknown>
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 50))
  const offset = (page - 1) * pageSize

  const [requirements, milestones, workItems, batches] = await Promise.all([
    listAllAimsRuntime<RuntimeRequirement>(event, `/v1/aims/projects/${encodeURIComponent(String(projectId))}/requirements`),
    listAllAimsRuntime<RuntimeMilestone>(event, `/v1/aims/projects/${encodeURIComponent(String(projectId))}/milestones`),
    listAllAimsRuntime<RuntimeWorkItem>(event, `/v1/aims/projects/${encodeURIComponent(String(projectId))}/work-items`),
    listAllAimsRuntime<RuntimeReviewBatch>(event, `/v1/aims/projects/${encodeURIComponent(String(projectId))}/requirement-reviews`)
  ])

  const rows = requirements
    .filter(req => matchesRequirementFilters(req, query))
    .sort((a, b) => compareRequirements(a, b, query))
  const pagedRows = rows.slice(offset, offset + pageSize)
  const milestoneById = new Map(milestones.map(item => [numberValue(item.id), item]))
  const workItemByRequirementId = new Map<number, RuntimeWorkItem>()
  for (const item of workItems) {
    if (stringValue(item.type) !== 'task' && stringValue(item.type) !== 'change_request') continue
    const requirementId = nullableNumberValue(item.requirement_id)
    if (requirementId && !workItemByRequirementId.has(requirementId)) {
      workItemByRequirementId.set(requirementId, item)
    }
  }

  return {
    code: 0,
    data: {
      items: pagedRows.map((r) => {
        const milestone = milestoneById.get(nullableNumberValue(r.milestone_id) || 0)
        const workItem = workItemByRequirementId.get(numberValue(r.id))
        return {
          id: numberValue(r.id),
          itemKind: stringValue(r.item_kind) || 'baseline',
          parentRequirementId: nullableNumberValue(r.parent_requirement_id),
          changeNo: nullableNumberValue(r.change_no),
          changeReason: stringValue(r.change_reason) || null,
          scopeNote: stringValue(r.scope_note) || null,
          reqNumber: numberValue(r.req_number),
          reqCode: stringValue(r.req_code),
          title: stringValue(r.title),
          type: stringValue(r.type),
          category: stringValue(r.category) || null,
          priority: stringValue(r.priority),
          source: stringValue(r.source),
          milestoneId: nullableNumberValue(r.milestone_id),
          milestoneName: milestone ? stringValue(milestone.name) : null,
          status: stringValue(r.status),
          currentVersion: numberValue(r.current_version),
          baselinedAt: stringValue(r.baselined_at) || null,
          taskItemKey: workItem ? stringValue(workItem.item_key) : null,
          taskStatus: workItem ? stringValue(workItem.status) : null,
          contentCount: 0,
          createdBy: stringValue(r.created_by),
          createdAt: stringValue(r.created_at),
          updatedAt: stringValue(r.updated_at)
        }
      }),
      total: rows.length,
      page,
      pageSize,
      statusCounts: buildStatusCounts(requirements),
      baselineSummary: buildBaselineSummary(requirements, batches)
    }
  }
})

function matchesRequirementFilters(req: RuntimeRequirement, query: Record<string, unknown>) {
  if (query.status && typeof query.status === 'string') {
    if (query.status === 'active') {
      if (stringValue(req.status) === 'deprecated') return false
    } else if (stringValue(req.status) !== query.status) {
      return false
    }
  } else if (stringValue(req.status) === 'deprecated') {
    return false
  }

  if (query.type && typeof query.type === 'string' && query.type !== 'all' && stringValue(req.type) !== query.type) return false
  if (query.priority && typeof query.priority === 'string' && query.priority !== 'all' && stringValue(req.priority) !== query.priority) return false
  if (query.milestone_id && Number(query.milestone_id) && nullableNumberValue(req.milestone_id) !== Number(query.milestone_id)) return false
  if (query.source && typeof query.source === 'string' && stringValue(req.source) !== query.source) return false
  if (query.work_item_id && Number(query.work_item_id) && nullableNumberValue(req.work_item_id) !== Number(query.work_item_id)) return false
  if (query.search && typeof query.search === 'string') {
    const term = query.search.toLowerCase()
    const haystack = `${stringValue(req.title)} ${stringValue(req.req_code)}`.toLowerCase()
    if (!haystack.includes(term)) return false
  }
  return true
}

function compareRequirements(a: RuntimeRequirement, b: RuntimeRequirement, query: Record<string, unknown>) {
  const sort = ['req_number', 'priority', 'status', 'created_at', 'updated_at'].includes(String(query.sort))
    ? String(query.sort)
    : 'req_number'
  const direction = String(query.order).toUpperCase() === 'DESC' ? -1 : 1
  const aValue = a[sort as keyof RuntimeRequirement]
  const bValue = b[sort as keyof RuntimeRequirement]
  if (sort === 'req_number') return (numberValue(aValue) - numberValue(bValue)) * direction
  return stringValue(aValue).localeCompare(stringValue(bValue)) * direction
}

function buildStatusCounts(requirements: RuntimeRequirement[]) {
  const counts: Record<string, number> = {}
  for (const req of requirements) {
    const status = stringValue(req.status)
    if (!status) continue
    counts[status] = (counts[status] || 0) + 1
  }
  return counts
}

function buildBaselineSummary(requirements: RuntimeRequirement[], batches: RuntimeReviewBatch[]) {
  return {
    draftCount: requirements.filter(req => stringValue(req.item_kind) === 'baseline' && stringValue(req.status) === 'draft').length,
    baselinedCount: requirements.filter(req => stringValue(req.item_kind) === 'baseline' && stringValue(req.status) === 'baselined').length,
    pendingBatchCount: batches.filter(batch => stringValue(batch.batch_type) === 'baseline' && stringValue(batch.status) === 'pending').length
  }
}
