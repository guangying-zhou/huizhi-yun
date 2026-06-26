/**
 * 获取里程碑详情
 * GET /api/v1/milestones/:id
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
  payment_term_id: number | null
  start_date: string | null
  end_date: string | null
  status: string
  recurrence_rule: string | null
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
  total_weight: number
  completed_weight: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const milestoneId = Number(getRouterParam(event, 'id'))
  if (!milestoneId || isNaN(milestoneId)) {
    throw createError({ statusCode: 400, message: '无效的里程碑ID' })
  }

  const milestone = await queryRow<MilestoneRow>(
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
            IFNULL(SUM(wi.weight), 0) AS total_weight,
            IFNULL(SUM(CASE WHEN wi.status = 'completed' THEN wi.weight ELSE 0 END), 0) AS completed_weight
     FROM milestones m
     LEFT JOIN work_items wi ON wi.project_id = m.project_id AND wi.milestone_id = m.id
     WHERE m.id = ?
     GROUP BY m.id`,
    [milestoneId]
  )
  if (!milestone) {
    throw createError({ statusCode: 404, message: '里程碑不存在' })
  }

  const deliverables = await fetchMilestoneDeliverables(milestone.project_id, milestone.id)

  return {
    code: 0,
    data: {
      id: milestone.id,
      projectId: milestone.project_id,
      templateKey: milestone.template_key,
      name: milestone.name,
      description: milestone.description,
      mode: milestone.mode,
      pivrStage: milestone.pivr_stage,
      paymentTermId: milestone.payment_term_id,
      startDate: milestone.start_date,
      endDate: milestone.end_date,
      status: milestone.status,
      deliverables,
      recurrenceRule: milestone.recurrence_rule,
      sortOrder: milestone.sort_order,
      createdBy: milestone.created_by,
      createdAt: milestone.created_at,
      updatedAt: milestone.updated_at,
      progress: milestone.total_weight > 0 ? Math.round((milestone.completed_weight / milestone.total_weight) * 100) : 0
    }
  }
})
