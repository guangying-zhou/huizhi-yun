/**
 * 获取需求版本快照列表
 * GET /api/v1/requirements/:reqId/versions
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface VersionRow extends RowDataPacket {
  id: number
  version_no: number
  snapshot_json: string
  change_type: string
  change_reason: string | null
  batch_id: number | null
  approved_by: string | null
  approved_at: string | null
  created_by: string
  created_at: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const reqId = Number(getRouterParam(event, 'reqId'))
  if (!reqId || Number.isNaN(reqId)) {
    throw createError({ statusCode: 400, message: '无效的需求ID' })
  }

  const versions = await queryRows<VersionRow[]>(
    `SELECT id, version_no, snapshot_json, change_type, change_reason,
            batch_id, approved_by, approved_at, created_by, created_at
     FROM requirement_versions
     WHERE requirement_id = ?
     ORDER BY version_no DESC`,
    [reqId]
  )

  return {
    code: 0,
    data: versions.map(v => ({
      id: v.id,
      versionNo: v.version_no,
      snapshot: JSON.parse(v.snapshot_json),
      changeType: v.change_type,
      changeReason: v.change_reason,
      batchId: v.batch_id,
      approvedBy: v.approved_by,
      approvedAt: v.approved_at,
      createdBy: v.created_by,
      createdAt: v.created_at
    }))
  }
})
