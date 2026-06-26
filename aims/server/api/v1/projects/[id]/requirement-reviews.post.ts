/**
 * 提交评审批次
 * POST /api/v1/projects/:id/requirement-reviews
 * Body: { batchType: 'baseline'|'change', requirementIds: number[], title?, description? }
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'

interface ReqStatusRow extends RowDataPacket {
  id: number
  status: string
  item_kind: string
  parent_requirement_id: number | null
  milestone_id: number | null
  milestone_name: string | null
}

interface RequirementMilestoneRow extends RowDataPacket {
  milestone_id: number | null
  milestone_name: string | null
  req_count: number
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

  const body = await readBody(event)
  const batchType = body.batchType === 'change' ? 'change' : 'baseline'
  const requirementIds: number[] = body.requirementIds
  if (!requirementIds?.length) {
    throw createError({ statusCode: 400, message: '请选择至少一条需求' })
  }

  const reqs = await queryRows<ReqStatusRow[]>(
    `SELECT r.id, r.status, r.item_kind, r.parent_requirement_id, r.milestone_id,
            m.name AS milestone_name
     FROM requirement_items r
     LEFT JOIN milestones m ON m.id = r.milestone_id
     WHERE r.id IN (${requirementIds.map(() => '?').join(',')}) AND r.project_id = ?`,
    [...requirementIds, projectId]
  )
  if (reqs.length !== requirementIds.length) {
    throw createError({ statusCode: 400, message: '部分需求不存在或不属于当前项目' })
  }

  const validReqs = reqs.filter((r) => {
    if (batchType === 'baseline') return r.item_kind === 'baseline' && r.status === 'draft'
    return r.item_kind === 'change' && r.status === 'draft' && !!r.parent_requirement_id
  })
  if (validReqs.length !== reqs.length) {
    const msg = batchType === 'baseline'
      ? '只能对草稿态的基线需求提交基线评审'
      : '只能对草稿态的变更需求提交变更评审'
    throw createError({ statusCode: 409, message: msg })
  }

  const activeMilestone = await queryRow<RowDataPacket & { id: number, name: string }>(
    `SELECT id, name
     FROM milestones
     WHERE project_id = ? AND status = 'active'
     ORDER BY sort_order ASC, id ASC
     LIMIT 1`,
    [projectId]
  )
  if (!activeMilestone) {
    throw createError({ statusCode: 409, message: '当前没有活动里程碑，暂不可创建需求评审批次' })
  }

  const milestoneRows = await queryRows<RequirementMilestoneRow[]>(
    `SELECT r.milestone_id, m.name AS milestone_name, COUNT(*) AS req_count
     FROM requirement_items r
     LEFT JOIN milestones m ON m.id = r.milestone_id
     WHERE r.project_id = ? AND r.id IN (${requirementIds.map(() => '?').join(',')})
     GROUP BY r.milestone_id, m.name`,
    [projectId, ...requirementIds]
  )

  const missingMilestoneCount = milestoneRows
    .filter(row => row.milestone_id == null)
    .reduce((sum, row) => sum + Number(row.req_count || 0), 0)
  if (missingMilestoneCount > 0) {
    throw createError({ statusCode: 409, message: `所选需求中有 ${missingMilestoneCount} 条未绑定里程碑，无法创建评审批次` })
  }

  if (milestoneRows.length !== 1 || milestoneRows[0]?.milestone_id !== activeMilestone.id) {
    const milestoneSummary = milestoneRows
      .map(row => row.milestone_name || `里程碑#${row.milestone_id}`)
      .join('、')
    throw createError({
      statusCode: 409,
      message: `仅当前活动里程碑「${activeMilestone.name}」的需求可创建评审批次，所选需求关联里程碑：${milestoneSummary}`
    })
  }

  if (batchType === 'change') {
    const parentIds = [...new Set(reqs.map(r => r.parent_requirement_id).filter((id): id is number => !!id))]
    const parentRows = await queryRows<ReqStatusRow[]>(
      `SELECT id, status, item_kind, parent_requirement_id
       FROM requirement_items
       WHERE id IN (${parentIds.map(() => '?').join(',')})
         AND project_id = ?`,
      [...parentIds, projectId]
    )
    const invalidParents = parentRows.filter(r => r.item_kind !== 'baseline' || r.status !== 'baselined')
    if (parentRows.length !== parentIds.length || invalidParents.length > 0) {
      throw createError({ statusCode: 409, message: '原需求不是已基线状态，无法提交变更评审' })
    }
  }

  if (batchType === 'baseline') {
    // 仅拦截"已准备但尚未提交审批"的基线批次：
    //   - 已准备未提交 => 应走"并入现有批次"，不允许再开新批次
    //   - 已提交审批（workflow_instance_id 非空）或首批已通过（已有基线项） => 允许续批
    const blockingBatchRow = await queryRow<RowDataPacket & { cnt: number }>(
      `SELECT COUNT(*) AS cnt
       FROM requirement_review_batches
       WHERE project_id = ?
         AND batch_type = 'baseline'
         AND status = 'pending'
         AND workflow_instance_id IS NULL`,
      [projectId]
    )
    if (Number(blockingBatchRow?.cnt || 0) > 0) {
      throw createError({ statusCode: 409, message: '存在尚未提交审批的基线评审批次，请先并入或取消当前批次' })
    }
  }

  const pool = useDbPool()
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()

    const [existingBatchRows] = await connection.query<(RowDataPacket & { id: number })[]>(
      `SELECT id
       FROM requirement_review_batches
       WHERE project_id = ? AND batch_type = ?`,
      [projectId, batchType]
    )
    const batchNo = existingBatchRows.length + 1
    const title = body.title?.trim() || (batchType === 'baseline'
      ? (batchNo === 1 ? '需求基线评审' : `需求变更评审 B${batchNo}`)
      : `需求变更评审 RC${batchNo}`)

    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO requirement_review_batches
       (project_id, batch_type, title, description, requirement_ids_json, status, submitted_by)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [projectId, batchType, title, body.description || null, JSON.stringify(requirementIds), uid]
    )
    const batchId = result.insertId

    const newStatus = batchType === 'baseline' ? 'in_review' : 'change_pending'
    await connection.execute(
      `UPDATE requirement_items SET status = ?
       WHERE id IN (${requirementIds.map(() => '?').join(',')})`,
      [newStatus, ...requirementIds]
    )
    if (batchType === 'change') {
      const parentIds = [...new Set(reqs.map(r => r.parent_requirement_id).filter((id): id is number => !!id))]
      await connection.execute(
        `UPDATE requirement_items SET status = 'change_pending'
         WHERE id IN (${parentIds.map(() => '?').join(',')})`,
        parentIds
      )
      await connection.execute(
        `UPDATE requirement_contents c
         INNER JOIN requirement_item_contents ric ON ric.content_id = c.id
         SET c.version_status = 'in_review'
         WHERE ric.requirement_id IN (${requirementIds.map(() => '?').join(',')})
           AND ric.relation_type = 'change'
           AND c.version_status = 'change_draft'`,
        requirementIds
      )
    }

    await connection.commit()

    return {
      code: 0,
      data: {
        batchId,
        batchType,
        title,
        requirementCount: requirementIds.length,
        status: 'pending'
      }
    }
  } catch (err) {
    await connection.rollback()
    throw err
  } finally {
    connection.release()
  }
})
