/**
 * 获取项目里程碑列表
 * GET /api/v1/projects/:id/milestones
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { fetchMilestoneDeliverablesMap } from '~~/server/utils/milestoneDeliverables'

interface MilestoneRow extends RowDataPacket {
  id: number
  project_id: number
  template_key: string | null
  name: string
  description: string | null
  mode: string
  pivr_stage: string | null
  payment_term_id: number | null
  start_date: string | null
  end_date: string | null
  status: string
  recurrence_rule: string | null
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
  // Roll-up 进度统计
  total_weight: number
  completed_weight: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const projectId = Number(getRouterParam(event, 'id'))
  if (!projectId || isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  // 获取里程碑列表（含 Roll-up 进度）
  const milestones = await queryRows<MilestoneRow[]>(
    `SELECT
            m.id,
            m.project_id,
            m.template_key,
            m.name,
            m.description,
            m.mode,
            m.pivr_stage,
            m.payment_term_id,
            m.start_date,
            m.end_date,
            m.status,
            m.recurrence_rule,
            m.sort_order,
            m.created_by,
            m.created_at,
            m.updated_at,
            IFNULL(wp.total_weight, 0) AS total_weight,
            IFNULL(wp.completed_weight, 0) AS completed_weight
     FROM milestones m
     LEFT JOIN (
       SELECT milestone_id, project_id,
              SUM(weight) AS total_weight,
              SUM(CASE WHEN status = 'completed' THEN weight ELSE 0 END) AS completed_weight
       FROM work_items
       WHERE project_id = ?
       GROUP BY milestone_id, project_id
     ) wp ON wp.project_id = m.project_id AND wp.milestone_id = m.id
     WHERE m.project_id = ?
     ORDER BY m.sort_order ASC, m.start_date ASC`,
    [projectId, projectId]
  )

  const deliverableMap = await fetchMilestoneDeliverablesMap(projectId, milestones.map(m => m.id))

  const items = milestones.map(m => ({
    id: m.id,
    projectId: m.project_id,
    templateKey: m.template_key,
    name: m.name,
    description: m.description,
    mode: m.mode,
    pivrStage: m.pivr_stage,
    paymentTermId: m.payment_term_id,
    startDate: m.start_date,
    endDate: m.end_date,
    status: m.status,
    deliverables: deliverableMap.get(m.id) || null,
    recurrenceRule: m.recurrence_rule,
    sortOrder: m.sort_order,
    createdBy: m.created_by,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
    progress: m.total_weight > 0 ? Math.round((m.completed_weight / m.total_weight) * 100) : 0
  }))

  return {
    code: 0,
    data: { milestones: items }
  }
})
