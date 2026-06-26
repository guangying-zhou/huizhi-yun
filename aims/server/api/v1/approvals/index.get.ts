/**
 * 查询审核记录列表
 * GET /api/v1/approvals?reviewer_uid=&requested_by=&status=&entity_type=&project_id=
 */
import type { RowDataPacket } from '~~/server/utils/db'
import {
  getAimsOwnerEntityIdSql,
  getAimsOwnerEntityTypeSql,
  normalizeAimsOwnerEntityType
} from '~~/server/utils/aimsOwners'

interface ApprovalRow extends RowDataPacket {
  id: number
  entity_type: string
  entity_id: number
  entity_code: string | null
  transition: string
  title: string | null
  requested_by: string
  requested_at: string
  request_comment: string | null
  reviewer_uid: string | null
  status: string
  reviewed_at: string | null
  review_comment: string | null
  project_id: number | null
  project_code: string | null
  created_at: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const query = getQuery(event)
  const conditions: string[] = []
  const params: unknown[] = []

  if (query.reviewer_uid) {
    conditions.push('a.reviewer_uid = ?')
    params.push(query.reviewer_uid)
  }

  if (query.requested_by) {
    conditions.push('a.requested_by = ?')
    params.push(query.requested_by)
  }

  if (query.status) {
    conditions.push('a.status = ?')
    params.push(query.status)
  }

  if (query.entity_type) {
    const entityType = normalizeAimsOwnerEntityType(String(query.entity_type))
    if (entityType === 'project') {
      conditions.push('a.project_owner_id IS NOT NULL')
    } else if (entityType === 'milestone') {
      conditions.push('a.milestone_owner_id IS NOT NULL')
    } else {
      conditions.push('a.work_item_owner_id IS NOT NULL')
    }
  }

  if (query.entity_id) {
    const entityId = Number(query.entity_id)
    const entityType = query.entity_type ? normalizeAimsOwnerEntityType(String(query.entity_type)) : null
    if (entityType === 'project') {
      conditions.push('a.project_owner_id = ?')
      params.push(entityId)
    } else if (entityType === 'milestone') {
      conditions.push('a.milestone_owner_id = ?')
      params.push(entityId)
    } else if (entityType === 'work_item') {
      conditions.push('a.work_item_owner_id = ?')
      params.push(entityId)
    } else {
      conditions.push('(a.project_owner_id = ? OR a.milestone_owner_id = ? OR a.work_item_owner_id = ?)')
      params.push(entityId, entityId, entityId)
    }
  }

  if (query.project_id) {
    conditions.push('a.project_id = ?')
    params.push(Number(query.project_id))
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = await queryRows<ApprovalRow[]>(
    `SELECT
        a.*,
        ${getAimsOwnerEntityTypeSql('a')} AS entity_type,
        ${getAimsOwnerEntityIdSql('a')} AS entity_id
     FROM approval_records a
     ${whereClause}
     ORDER BY a.created_at DESC
     LIMIT 100`,
    params
  )

  return {
    code: 0,
    data: rows.map(r => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      entityCode: r.entity_code,
      transition: r.transition,
      title: r.title,
      requestedBy: r.requested_by,
      requestedAt: r.requested_at,
      requestComment: r.request_comment,
      reviewerUid: r.reviewer_uid,
      status: r.status,
      reviewedAt: r.reviewed_at,
      reviewComment: r.review_comment,
      projectId: r.project_id,
      projectCode: r.project_code,
      createdAt: r.created_at
    }))
  }
})
