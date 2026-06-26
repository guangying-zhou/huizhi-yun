/**
 * 创建里程碑
 * POST /api/v1/projects/:id/milestones
 */
import type { ResultSetHeader, RowDataPacket } from '~~/server/utils/db'
import { syncMilestoneDeliverables } from '~~/server/utils/milestoneDeliverables'

interface ProjectRow extends RowDataPacket {
  id: number
  contract_id: number | null
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

  const body = await readBody(event)
  if (!body?.name?.trim()) {
    throw createError({ statusCode: 400, message: '里程碑名称不能为空' })
  }

  const mode = body.mode || 'rolling_plan'

  // 强约束模式必须设置截止日期
  if (mode === 'strong_constraint' && !body.endDate) {
    throw createError({ statusCode: 400, message: '强约束模式必须设置截止日期' })
  }

  // paymentTermId 业务校验：项目必须有 contractId，且 pivrStage 必须为 V
  if (body.paymentTermId) {
    const project = await queryRow<ProjectRow>(
      'SELECT id, contract_id FROM aims_projects WHERE id = ?',
      [projectId]
    )
    if (!project?.contract_id) {
      throw createError({ statusCode: 400, message: '项目未关联合同，不能绑定回款条款' })
    }
    if (body.pivrStage !== 'V') {
      throw createError({ statusCode: 400, message: '回款条款只能绑定到验证交付(V)阶段的里程碑' })
    }
  }

  const result = await execute<ResultSetHeader>(
    `INSERT INTO milestones (project_id, name, description, mode, pivr_stage, payment_term_id, start_date, end_date, recurrence_rule, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectId,
      body.name.trim(),
      body.description || null,
      mode,
      body.pivrStage || null,
      body.paymentTermId || null,
      body.startDate || null,
      body.endDate || null,
      body.recurrenceRule || null,
      uid
    ]
  )

  if (body.deliverables !== undefined) {
    await syncMilestoneDeliverables({
      milestoneId: result.insertId,
      projectId,
      createdBy: uid,
      items: body.deliverables
    })
  }

  return {
    code: 0,
    data: { id: result.insertId }
  }
})
