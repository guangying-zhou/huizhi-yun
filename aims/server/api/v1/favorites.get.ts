/**
 * 获取当前用户的常用项目列表
 * GET /api/v1/favorites
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface FavoriteRow extends RowDataPacket {
  project_id: number
  project_code: string
  name: string
  lifecycle_status: string
  created_at: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const rows = await queryRows<FavoriteRow[]>(
    `SELECT f.project_id, p.project_code, p.name, p.lifecycle_status, f.created_at
     FROM user_favorite_projects f
     INNER JOIN aims_projects p ON p.id = f.project_id
     WHERE f.uid = ?
     ORDER BY f.created_at DESC`,
    [uid]
  )

  return {
    code: 0,
    data: rows.map(r => ({
      projectId: r.project_id,
      projectCode: r.project_code,
      name: r.name,
      lifecycleStatus: r.lifecycle_status,
      createdAt: r.created_at
    }))
  }
})
