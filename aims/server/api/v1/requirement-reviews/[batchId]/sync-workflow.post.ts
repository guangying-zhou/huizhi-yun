/**
 * 同步 Workflow 实例 ID 到 batch 记录
 * POST /api/v1/requirement-reviews/:batchId/sync-workflow
 *
 * 调用 Workflow 服务查询本批次的实例，如果找到就把 instance_id 回写到 batch 表。
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { resolveWorkflowApiUrl } from '@hzy/foundation/server/utils/workflowRuntime'

interface BatchRow extends RowDataPacket {
  id: number
  batch_type: string
  project_id: number
  workflow_instance_id: string | null
  requirement_ids_json: string
}

interface BatchRequirementMilestoneRow extends RowDataPacket {
  milestone_id: number | null
  milestone_name: string | null
  req_count: number
}

function parseRequirementIds(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.map(value => Number(value)).filter(value => Number.isInteger(value) && value > 0)
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        return parsed.map(value => Number(value)).filter(value => Number.isInteger(value) && value > 0)
      }
    } catch {
      return []
    }
  }
  return []
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const batchId = Number(getRouterParam(event, 'batchId'))
  if (!batchId || Number.isNaN(batchId)) {
    throw createError({ statusCode: 400, message: '无效的批次ID' })
  }

  const batch = await queryRow<BatchRow>(
    'SELECT id, batch_type, project_id, workflow_instance_id, requirement_ids_json FROM requirement_review_batches WHERE id = ?',
    [batchId]
  )
  if (!batch) {
    throw createError({ statusCode: 404, message: '评审批次不存在' })
  }

  if (batch.workflow_instance_id) {
    return { code: 0, data: { alreadySynced: true, workflowInstanceId: batch.workflow_instance_id } }
  }

  const activeMilestone = await queryRow<RowDataPacket & { id: number, name: string }>(
    `SELECT id, name
     FROM milestones
     WHERE project_id = ? AND status = 'active'
     ORDER BY sort_order ASC, id ASC
     LIMIT 1`,
    [batch.project_id]
  )
  if (!activeMilestone) {
    throw createError({ statusCode: 409, message: '当前没有活动里程碑，暂不可提交需求评审' })
  }

  const requirementIds = parseRequirementIds(batch.requirement_ids_json)
  if (requirementIds.length === 0) {
    throw createError({ statusCode: 409, message: '该评审批次没有关联需求项，无法提交审批' })
  }

  const milestoneRows = await queryRows<BatchRequirementMilestoneRow[]>(
    `SELECT r.milestone_id, m.name AS milestone_name, COUNT(*) AS req_count
     FROM requirement_items r
     LEFT JOIN milestones m ON m.id = r.milestone_id
     WHERE r.project_id = ? AND r.id IN (${requirementIds.map(() => '?').join(',')})
     GROUP BY r.milestone_id, m.name`,
    [batch.project_id, ...requirementIds]
  )
  if (milestoneRows.length === 0) {
    throw createError({ statusCode: 409, message: '该评审批次没有可识别的里程碑信息，无法提交审批' })
  }

  const missingMilestoneCount = milestoneRows
    .filter(row => row.milestone_id == null)
    .reduce((sum, row) => sum + Number(row.req_count || 0), 0)
  if (missingMilestoneCount > 0) {
    throw createError({ statusCode: 409, message: `该评审批次有 ${missingMilestoneCount} 条需求未绑定里程碑，无法提交审批` })
  }

  if (milestoneRows.length !== 1 || milestoneRows[0]?.milestone_id !== activeMilestone.id) {
    const milestoneSummary = milestoneRows
      .map(row => row.milestone_name || `里程碑#${row.milestone_id}`)
      .join('、')
    throw createError({
      statusCode: 409,
      message: `仅当前活动里程碑「${activeMilestone.name}」的需求评审批次允许提交，当前批次关联里程碑：${milestoneSummary}`
    })
  }

  const actionCode = batch.batch_type === 'baseline' ? 'requirement_baseline' : 'requirement_change'

  try {
    const workflowApiUrl = await resolveWorkflowApiUrl()
    const url = `${workflowApiUrl}/api/v1/instances/by-biz?app_code=aims&resource_code=requirements&biz_id=${batchId}&action_code=${actionCode}`
    const accessToken = await requestServiceAccessToken({
      audience: 'workflow',
      scope: 'workflow:instances:read'
    })
    const res = await $fetch<{ code: number, data: { id: number } | null }>(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (res.code === 0 && res.data?.id) {
      const instanceId = String(res.data.id)
      await execute(
        'UPDATE requirement_review_batches SET workflow_instance_id = ? WHERE id = ?',
        [instanceId, batchId]
      )
      return { code: 0, data: { synced: true, workflowInstanceId: instanceId } }
    }
    return { code: 0, data: { synced: false, reason: 'instance not found' } }
  } catch (err) {
    console.warn('[sync-workflow] failed:', (err as Error)?.message)
    return { code: 0, data: { synced: false, reason: 'workflow error' } }
  }
})
