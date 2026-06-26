/**
 * 更新里程碑
 * PUT /api/v1/milestones/:id
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { syncMilestoneDeliverables } from '~~/server/utils/milestoneDeliverables'

interface MilestoneRow extends RowDataPacket {
  id: number
  project_id: number
  status: string
  mode: string
  pivr_stage: string | null
  end_date: string | null
}

interface ProjectContractRow extends RowDataPacket {
  contract_id: number | null
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
    'SELECT id, project_id, status, mode, pivr_stage, end_date FROM milestones WHERE id = ?',
    [milestoneId]
  )
  if (!milestone) {
    throw createError({ statusCode: 404, message: '里程碑不存在' })
  }

  const body = await readBody(event)

  const fields: string[] = []
  const params: unknown[] = []

  if (body.name !== undefined) {
    fields.push('name = ?')
    params.push(body.name.trim())
  }
  if (body.description !== undefined) {
    fields.push('description = ?')
    params.push(body.description)
  }
  if (body.startDate !== undefined) {
    fields.push('start_date = ?')
    params.push(body.startDate)
  }
  if (body.endDate !== undefined) {
    fields.push('end_date = ?')
    params.push(body.endDate)
  }
  if (body.mode !== undefined) {
    fields.push('mode = ?')
    params.push(body.mode)
  }
  if (body.pivrStage !== undefined) {
    fields.push('pivr_stage = ?')
    params.push(body.pivrStage)
  }
  if (body.paymentTermId !== undefined) {
    fields.push('payment_term_id = ?')
    params.push(body.paymentTermId)
  }
  if (body.status !== undefined) {
    fields.push('status = ?')
    params.push(body.status)
  }
  if (body.recurrenceRule !== undefined) {
    fields.push('recurrence_rule = ?')
    params.push(body.recurrenceRule)
  }
  if (body.sortOrder !== undefined) {
    fields.push('sort_order = ?')
    params.push(body.sortOrder)
  }

  if (fields.length === 0 && body.deliverables === undefined) {
    throw createError({ statusCode: 400, message: '没有需要更新的字段' })
  }

  // strong_constraint 不变量：必须有截止日期
  const finalMode = body.mode !== undefined ? body.mode : milestone.mode
  const finalEndDate = body.endDate !== undefined ? body.endDate : milestone.end_date
  if (finalMode === 'strong_constraint' && !finalEndDate) {
    throw createError({ statusCode: 400, message: '强约束模式必须设置截止日期' })
  }

  // paymentTermId 业务校验
  if (body.paymentTermId !== undefined && body.paymentTermId !== null) {
    const projectCheck = await queryRow<ProjectContractRow>(
      'SELECT contract_id FROM aims_projects WHERE id = ?',
      [milestone.project_id]
    )
    if (!projectCheck?.contract_id) {
      throw createError({ statusCode: 400, message: '项目未关联合同，不能绑定回款条款' })
    }
    const finalPivrStage = body.pivrStage !== undefined ? body.pivrStage : milestone.pivr_stage
    if (finalPivrStage !== 'V') {
      throw createError({ statusCode: 400, message: '回款条款只能绑定到验证交付(V)阶段的里程碑' })
    }
  }

  if (fields.length > 0) {
    params.push(milestoneId)
    await execute(
      `UPDATE milestones SET ${fields.join(', ')} WHERE id = ?`,
      params
    )
  }

  if (body.deliverables !== undefined) {
    await syncMilestoneDeliverables({
      milestoneId,
      projectId: milestone.project_id,
      createdBy: uid,
      items: body.deliverables
    })
  }

  return { code: 0, data: null }
})
