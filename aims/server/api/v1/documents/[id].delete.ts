/**
 * 删除文档/文件夹
 * DELETE /api/v1/documents/:id
 * 如果是文件夹，同时删除所有子文档（递归）
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'
import { requireProjectDocumentMember } from '~~/server/utils/projectDocumentAccess'

interface IdRow extends RowDataPacket {
  id: number
}

async function collectDescendantIds(parentId: number): Promise<number[]> {
  const children = await queryRows<IdRow[]>(
    'SELECT id FROM project_documents WHERE parent_id = ?',
    [parentId]
  )
  const ids: number[] = []
  for (const child of children) {
    ids.push(child.id)
    const subIds = await collectDescendantIds(child.id)
    ids.push(...subIds)
  }
  return ids
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '缺少文档 ID' })
  }

  const docId = Number(id)
  await requireProjectDocumentMember(
    event,
    docId,
    uid,
    '仅项目成员可以删除项目文档'
  )

  // 收集当前文档及所有子孙文档的 ID
  const descendantIds = await collectDescendantIds(docId)
  const allIds = [docId, ...descendantIds]

  const placeholders = allIds.map(() => '?').join(', ')
  const result = await execute<ResultSetHeader>(
    `DELETE FROM project_documents WHERE id IN (${placeholders})`,
    allIds
  )

  if (result.affectedRows === 0) {
    throw createError({ statusCode: 404, message: '文档不存在' })
  }

  return {
    code: 0,
    message: '删除成功',
    data: {
      deletedCount: result.affectedRows
    }
  }
})
