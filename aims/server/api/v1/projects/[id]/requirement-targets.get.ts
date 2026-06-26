/**
 * 查询项目的需求工作项（type=requirement, tier=target）列表
 * GET /api/v1/projects/:id/requirement-targets
 * 返回基线 target + 所有变更 target，用于 ProjectNavbar 判断显示、需求页面切换批次
 */
import { listAllAimsRuntime, nullableNumberValue, numberValue, stringValue } from '~~/server/utils/aimsRuntimePages'

interface RuntimeRequirement {
  id?: number
  title?: string
  req_code?: string
  type?: string
  status?: string
  priority?: string
  milestone_id?: number | null
  source?: string
  work_item_id?: number | null
}

interface RuntimeWorkItem {
  id?: number
  item_key?: string
  title?: string
  status?: string
  type?: string
  tier?: string
  parent_id?: number | null
  requirement_id?: number | null
  milestone_id?: number | null
  template_key?: string | null
  created_at?: string
}

interface RuntimeMilestone {
  id?: number
  name?: string
  pivr_stage?: string
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
  const [requirements, workItems, milestones] = await Promise.all([
    listAllAimsRuntime<RuntimeRequirement>(event, `/v1/aims/projects/${encodeURIComponent(String(projectId))}/requirements`),
    listAllAimsRuntime<RuntimeWorkItem>(event, `/v1/aims/projects/${encodeURIComponent(String(projectId))}/work-items`),
    listAllAimsRuntime<RuntimeMilestone>(event, `/v1/aims/projects/${encodeURIComponent(String(projectId))}/milestones`)
  ])

  const filteredRequirements = requirements.filter(req => matchesRequirementFilters(req, query))
  const requirementIds = new Set(filteredRequirements.map(req => numberValue(req.id)).filter(Boolean))
  const requirementCountByTarget = new Map<number, number>()
  for (const req of filteredRequirements) {
    const targetId = nullableNumberValue(req.work_item_id)
    if (!targetId) continue
    requirementCountByTarget.set(targetId, (requirementCountByTarget.get(targetId) || 0) + 1)
  }

  const taskCountByTarget = new Map<number, number>()
  for (const item of workItems) {
    if (stringValue(item.type) !== 'task') continue
    const requirementId = nullableNumberValue(item.requirement_id)
    const targetId = nullableNumberValue(item.parent_id)
    if (!requirementId || !targetId || !requirementIds.has(requirementId)) continue
    taskCountByTarget.set(targetId, (taskCountByTarget.get(targetId) || 0) + 1)
  }

  const milestoneById = new Map(milestones.map(item => [numberValue(item.id), item]))
  const rows = workItems
    .filter(item => stringValue(item.tier) === 'target' && stringValue(item.type) === 'requirement')
    .sort((a, b) => {
      const aBaseline = stringValue(a.template_key) === 'requirement_baseline' ? 0 : 1
      const bBaseline = stringValue(b.template_key) === 'requirement_baseline' ? 0 : 1
      if (aBaseline !== bBaseline) return aBaseline - bBaseline
      const createdCompare = stringValue(a.created_at).localeCompare(stringValue(b.created_at))
      if (createdCompare !== 0) return createdCompare
      return numberValue(a.id) - numberValue(b.id)
    })

  // 项目内第一个（排序后）需求 target 视为"基线 target"
  const baselineId = numberValue(rows[0]?.id) || null

  return {
    code: 0,
    data: {
      items: rows.map((r) => {
        const id = numberValue(r.id)
        const milestone = milestoneById.get(nullableNumberValue(r.milestone_id) || 0)
        return {
          id,
          itemKey: stringValue(r.item_key),
          title: stringValue(r.title),
          status: stringValue(r.status),
          milestoneId: nullableNumberValue(r.milestone_id),
          milestoneName: milestone ? stringValue(milestone.name) : null,
          milestonePivrStage: milestone ? stringValue(milestone.pivr_stage) : null,
          templateKey: stringValue(r.template_key) || null,
          isBaseline: id === baselineId,
          requirementCount: requirementCountByTarget.get(id) || 0,
          taskCount: taskCountByTarget.get(id) || 0,
          createdAt: stringValue(r.created_at)
        }
      })
    }
  }
})

function matchesRequirementFilters(req: RuntimeRequirement, query: Record<string, unknown>) {
  if (stringValue(req.status) === 'deprecated') return false
  if (query.type && typeof query.type === 'string' && query.type !== 'all' && stringValue(req.type) !== query.type) return false
  if (query.status && typeof query.status === 'string' && query.status !== 'all' && query.status !== 'active' && stringValue(req.status) !== query.status) return false
  if (query.priority && typeof query.priority === 'string' && query.priority !== 'all' && stringValue(req.priority) !== query.priority) return false
  if (query.milestone_id && typeof query.milestone_id === 'string') {
    const milestoneId = Number(query.milestone_id)
    if (!Number.isNaN(milestoneId) && milestoneId > 0 && nullableNumberValue(req.milestone_id) !== milestoneId) return false
  }
  if (query.source && typeof query.source === 'string' && stringValue(req.source) !== query.source) return false
  if (query.search && typeof query.search === 'string' && query.search.trim()) {
    const term = query.search.trim().toLowerCase()
    const haystack = `${stringValue(req.title)} ${stringValue(req.req_code)}`.toLowerCase()
    if (!haystack.includes(term)) return false
  }
  return true
}
