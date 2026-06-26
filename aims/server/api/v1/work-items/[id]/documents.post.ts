/**
 * 关联文档到工作项
 * POST /api/v1/work-items/:id/documents
 * Body: { documentId: string }
 */
import type { ResultSetHeader, RowDataPacket } from '~~/server/utils/db'

interface WorkItemRow extends RowDataPacket {
  id: number
  project_id: number
  project_code: string
}

interface SourceDocumentRow extends RowDataPacket {
  id: number
  uuid: string
  title: string
  doc_category: string | null
  is_folder: number
  oss_path: string | null
  codocs_uuid: string | null
  content_size: number
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

  const body = await readBody<{ documentId?: string }>(event)
  if (!body.documentId) {
    throw createError({ statusCode: 400, message: 'documentId 不能为空' })
  }

  // 验证工作项存在
  const item = await queryRow<WorkItemRow>(
    `SELECT wi.id, wi.project_id, p.project_code
     FROM work_items wi
     JOIN aims_projects p ON p.id = wi.project_id
     WHERE wi.id = ?`,
    [id]
  )
  if (!item) {
    throw createError({ statusCode: 404, message: '工作项不存在' })
  }

  const documentId = body.documentId.trim()
  const existingLink = await queryRow<RowDataPacket>(
    `SELECT id
     FROM project_documents
     WHERE work_item_id = ?
       AND is_folder = 0
       AND (uuid = ? OR codocs_uuid = ?)
     LIMIT 1`,
    [id, documentId, documentId]
  )
  if (existingLink) {
    throw createError({ statusCode: 409, message: '该文档已关联' })
  }

  const sourceDocument = await queryRow<SourceDocumentRow>(
    `SELECT id, uuid, title, doc_category, is_folder, oss_path, codocs_uuid, content_size
     FROM project_documents
     WHERE is_folder = 0
       AND (uuid = ? OR codocs_uuid = ?)
     ORDER BY CASE WHEN uuid = ? THEN 0 ELSE 1 END, id ASC
     LIMIT 1`,
    [documentId, documentId, documentId]
  )

  const linkedDocumentUuid = sourceDocument?.codocs_uuid || sourceDocument?.uuid || documentId

  try {
    const result = await execute<ResultSetHeader>(
      `INSERT INTO project_documents
        (uuid, project_id, project_code, work_item_id, parent_id,
         title, doc_category, is_folder, oss_path, codocs_uuid, content_size, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        item.project_id,
        item.project_code,
        id,
        null,
        sourceDocument?.title || `文档 ${documentId}`,
        sourceDocument?.doc_category || null,
        sourceDocument?.oss_path || null,
        linkedDocumentUuid,
        sourceDocument?.content_size || 0,
        uid,
        uid
      ]
    )

    return {
      code: 0,
      data: {
        id: result.insertId,
        workItemId: id,
        documentId: linkedDocumentUuid,
        linkedBy: uid
      }
    }
  } catch (error: unknown) {
    const err = error as { code?: string }
    if (err.code === 'ER_DUP_ENTRY') {
      throw createError({ statusCode: 409, message: '该文档已关联' })
    }
    throw error
  }
})
