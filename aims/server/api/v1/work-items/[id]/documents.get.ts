/**
 * 获取工作项关联文档列表
 * GET /api/v1/work-items/:id/documents
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface DocumentRow extends RowDataPacket {
  id: number
  uuid: string
  work_item_id: number
  codocs_uuid: string | null
  title: string
  created_by: string
  created_at: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的工作项ID' })
  }

  const documents = await queryRows<DocumentRow[]>(
    `SELECT id, uuid, work_item_id, codocs_uuid, title, created_by, created_at
     FROM project_documents
     WHERE work_item_id = ?
       AND is_folder = 0
     ORDER BY created_at DESC`,
    [id]
  )

  return {
    code: 0,
    data: documents.map(d => ({
      id: d.id,
      workItemId: d.work_item_id,
      documentId: d.codocs_uuid || d.uuid,
      linkedBy: d.created_by,
      linkedAt: d.created_at,
      documentTitle: d.title
    }))
  }
})
