/**
 * 里程碑详情聚合：里程碑 + 其下 target（含 matter 子任务）+ 任务下的 deliverables
 * GET /api/v1/milestones/:id/detail
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { fetchMilestoneDeliverables } from '~~/server/utils/milestoneDeliverables'

interface MilestoneRow extends RowDataPacket {
  id: number
  project_id: number
  template_key: string | null
  name: string
  description: string | null
  mode: string
  pivr_stage: string | null
  start_date: string | null
  end_date: string | null
  status: string
  sort_order: number
  total_weight: number
  completed_weight: number
}

interface WorkItemRow extends RowDataPacket {
  id: number
  project_id: number
  milestone_id: number
  item_key: string
  tier: string
  type: string
  title: string
  description: string | null
  status: string
  priority: string
  assignee_uid: string | null
  reporter_uid: string | null
  start_date: string | null
  due_date: string | null
  estimated_hours: number | null
  parent_id: number | null
  template_key: string | null
  sort_order: number
  created_at: string
  requirement_id: number | null
}

interface DeliverableRow extends RowDataPacket {
  id: number
  target_id: number | null
  matter_id: number | null
  name: string
  description: string | null
  acceptance_criteria: string | null
  deliverable_type: string
  required: number
  status: string
  sort_order: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) throw createError({ statusCode: 401, message: '请先登录' })

  const milestoneId = Number(getRouterParam(event, 'id'))
  if (!milestoneId || Number.isNaN(milestoneId)) {
    throw createError({ statusCode: 400, message: '无效的里程碑ID' })
  }

  const milestone = await queryRow<MilestoneRow>(
    `SELECT m.id, m.project_id, m.template_key, m.name, m.description, m.mode,
            m.pivr_stage, m.start_date, m.end_date, m.status, m.sort_order,
            IFNULL(SUM(wi.weight), 0) AS total_weight,
            IFNULL(SUM(CASE WHEN wi.status = 'completed' THEN wi.weight ELSE 0 END), 0) AS completed_weight
     FROM milestones m
     LEFT JOIN work_items wi ON wi.project_id = m.project_id AND wi.milestone_id = m.id
     WHERE m.id = ?
     GROUP BY m.id`,
    [milestoneId]
  )
  if (!milestone) throw createError({ statusCode: 404, message: '里程碑不存在' })

  const milestoneDeliverables = await fetchMilestoneDeliverables(milestone.project_id, milestone.id)

  const items = await queryRows<WorkItemRow[]>(
    `SELECT id, project_id, milestone_id, item_key, tier, type, title, description,
            status, priority, assignee_uid, reporter_uid, start_date, due_date,
            estimated_hours, parent_id, template_key, sort_order, created_at, requirement_id
     FROM work_items
     WHERE milestone_id = ?
     ORDER BY tier ASC, sort_order ASC, id ASC`,
    [milestoneId]
  )

  const targetIds = items.filter(i => i.tier === 'target').map(i => i.id)
  const matterIds = items.filter(i => i.tier === 'matter').map(i => i.id)
  const scopeIds = [...new Set([...targetIds, ...matterIds])]
  let rawDeliverables: DeliverableRow[] = []
  if (scopeIds.length > 0) {
    rawDeliverables = await queryRows<DeliverableRow[]>(
      `SELECT id, target_id, matter_id, name, description, acceptance_criteria, deliverable_type,
              required, status, sort_order
       FROM deliverables
       WHERE target_id IN (${scopeIds.map(() => '?').join(',')})
          OR matter_id IN (${scopeIds.map(() => '?').join(',')})
       ORDER BY sort_order ASC, id ASC`,
      [...scopeIds, ...scopeIds]
    )
  }
  const deliverablesByMatter = new Map<number, DeliverableRow[]>()
  const deliverablesByTarget = new Map<number, DeliverableRow[]>()
  for (const d of rawDeliverables) {
    if (d.matter_id) {
      if (!deliverablesByMatter.has(d.matter_id)) deliverablesByMatter.set(d.matter_id, [])
      deliverablesByMatter.get(d.matter_id)!.push(d)
    } else if (d.target_id) {
      if (!deliverablesByTarget.has(d.target_id)) deliverablesByTarget.set(d.target_id, [])
      deliverablesByTarget.get(d.target_id)!.push(d)
    }
  }
  const mapDeliverable = (d: DeliverableRow) => ({
    id: d.id,
    targetId: d.target_id,
    matterId: d.matter_id,
    name: d.name,
    description: d.description,
    acceptanceCriteria: d.acceptance_criteria,
    deliverableType: d.deliverable_type,
    required: !!d.required,
    status: d.status,
    sortOrder: d.sort_order
  })

  const mapItem = (row: WorkItemRow) => ({
    id: row.id,
    itemKey: row.item_key,
    tier: row.tier,
    type: row.type,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assigneeUid: row.assignee_uid,
    reporterUid: row.reporter_uid,
    startDate: row.start_date,
    dueDate: row.due_date,
    estimatedHours: row.estimated_hours != null ? Number(row.estimated_hours) : null,
    parentId: row.parent_id,
    templateKey: row.template_key,
    sortOrder: row.sort_order,
    requirementId: row.requirement_id
  })

  const targets = items.filter(i => i.tier === 'target').map(t => ({
    ...mapItem(t),
    deliverables: (deliverablesByTarget.get(t.id) || []).map(mapDeliverable),
    matters: items
      .filter(m => m.tier === 'matter' && m.parent_id === t.id)
      .map(m => ({
        ...mapItem(m),
        deliverables: (deliverablesByMatter.get(m.id) || []).map(mapDeliverable)
      }))
  }))

  // 未归属到任何 target 的 matter（独立任务）
  const orphanMatters = items
    .filter(m => m.tier === 'matter' && (m.parent_id == null || !targets.some(t => t.id === m.parent_id)))
    .map(m => ({
      ...mapItem(m),
      deliverables: (deliverablesByMatter.get(m.id) || []).map(mapDeliverable)
    }))

  return {
    code: 0,
    data: {
      milestone: {
        id: milestone.id,
        projectId: milestone.project_id,
        templateKey: milestone.template_key,
        name: milestone.name,
        description: milestone.description,
        mode: milestone.mode,
        pivrStage: milestone.pivr_stage,
        startDate: milestone.start_date,
        endDate: milestone.end_date,
        status: milestone.status,
        sortOrder: milestone.sort_order,
        progress: milestone.total_weight > 0 ? Math.round((milestone.completed_weight / milestone.total_weight) * 100) : 0,
        deliverables: milestoneDeliverables
      },
      targets,
      orphanMatters
    }
  }
})
