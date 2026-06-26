/**
 * 取消关联文档
 * DELETE /api/v1/work-items/:id/documents/:documentId
 */
export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的工作项ID' })
  }

  const documentId = getRouterParam(event, 'documentId')
  if (!documentId) {
    throw createError({ statusCode: 400, message: 'documentId 参数不能为空' })
  }

  const result = await execute(
    `DELETE FROM project_documents
     WHERE work_item_id = ?
       AND (uuid = ? OR codocs_uuid = ?)`,
    [id, documentId, documentId]
  )

  if (result.affectedRows === 0) {
    throw createError({ statusCode: 404, message: '关联记录不存在' })
  }

  return {
    code: 0,
    data: { message: '已取消关联' }
  }
})
