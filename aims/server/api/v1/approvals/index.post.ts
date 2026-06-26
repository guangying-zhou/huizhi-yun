/**
 * 创建审核记录
 * POST /api/v1/approvals
 */
import type { ResultSetHeader } from '~~/server/utils/db'
import { resolveAimsOwnerColumns, resolveAimsProjectContext } from '~~/server/utils/aimsOwners'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const body = await readBody(event)

  if (!body.entityType || !body.entityId || !body.transition) {
    throw createError({ statusCode: 400, message: '缺少必填参数: entityType, entityId, transition' })
  }

  if (!body.reviewerUid) {
    throw createError({ statusCode: 400, message: '请指定审核人' })
  }

  const owner = resolveAimsOwnerColumns(body.entityType, Number(body.entityId))
  const projectContext = body.projectId
    ? { projectId: Number(body.projectId), projectCode: body.projectCode || null }
    : await resolveAimsProjectContext(body.entityType, Number(body.entityId))

  if (!projectContext.projectId) {
    throw createError({ statusCode: 400, message: `无法解析审核记录所属项目: ${body.entityType}#${body.entityId}` })
  }

  const result = await execute<ResultSetHeader>(
    `INSERT INTO approval_records
      (project_owner_id, milestone_owner_id, work_item_owner_id,
       entity_code, transition, title,
       requested_by, request_comment, reviewer_uid, status,
       project_id, project_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      owner.projectOwnerId,
      owner.milestoneOwnerId,
      owner.workItemOwnerId,
      body.entityCode || null,
      body.transition,
      body.title || null,
      uid,
      body.requestComment || null,
      body.reviewerUid,
      projectContext.projectId,
      projectContext.projectCode
    ]
  )

  return {
    code: 0,
    data: {
      id: result.insertId
    }
  }
})
