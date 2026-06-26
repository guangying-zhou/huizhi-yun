/**
 * 更新文档
 * PUT /api/v1/documents/:id
 */
import type { ResultSetHeader, RowDataPacket } from '~~/server/utils/db'
import { resolveDocumentOwnerContext } from '~~/server/utils/documentOwners'
import { requireProjectDocumentMember } from '~~/server/utils/projectDocumentAccess'

interface ParentRow extends RowDataPacket {
  parent_id: number | null
}

async function assertNoDocumentCycle(documentId: number, parentId: number | null) {
  if (!parentId) return
  if (parentId === documentId) {
    throw createError({ statusCode: 400, message: '父目录不能是文档自身' })
  }

  let currentParentId: number | null = parentId
  while (currentParentId) {
    if (currentParentId === documentId) {
      throw createError({ statusCode: 400, message: '不能将文档移动到其子目录下' })
    }
    const row: ParentRow | null = await queryRow<ParentRow>(
      'SELECT parent_id FROM project_documents WHERE id = ?',
      [currentParentId]
    )
    currentParentId = row?.parent_id ?? null
  }
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
  const documentId = Number(id)

  const body = await readBody(event)
  const { owner: currentDocument } = await requireProjectDocumentMember(
    event,
    documentId,
    uid,
    '仅项目成员可以编辑项目文档'
  )

  const fields: string[] = []
  const params: unknown[] = []

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      throw createError({ statusCode: 400, message: '标题不能为空' })
    }
    fields.push('title = ?')
    params.push(body.title.trim())
  }

  if (body.docCategory !== undefined) {
    fields.push('doc_category = ?')
    params.push(body.docCategory)
  }

  if (body.parentId !== undefined) {
    const targetParentId = body.parentId ? Number(body.parentId) : null
    await assertNoDocumentCycle(documentId, targetParentId)

    fields.push('parent_id = ?')
    params.push(targetParentId)

    const owner = await resolveDocumentOwnerContext({
      parentId: targetParentId,
      portfolioId: currentDocument.portfolioId,
      projectId: currentDocument.projectId,
      projectCode: currentDocument.projectCode,
      milestoneId: currentDocument.milestoneId,
      workItemId: currentDocument.workItemId
    })
    fields.push('portfolio_id = ?')
    params.push(owner.portfolioId)
    fields.push('project_id = ?')
    params.push(owner.projectId)
    fields.push('project_code = ?')
    params.push(owner.projectCode)
    fields.push('milestone_id = ?')
    params.push(owner.milestoneId)
    fields.push('work_item_id = ?')
    params.push(owner.workItemId)
  }

  if (body.sortOrder !== undefined) {
    fields.push('sort_order = ?')
    params.push(Number(body.sortOrder))
  }

  if (body.codocsUuid !== undefined) {
    fields.push('codocs_uuid = ?')
    params.push(body.codocsUuid)
  }

  if (fields.length === 0) {
    throw createError({ statusCode: 400, message: '没有需要更新的字段' })
  }

  fields.push('updated_by = ?')
  params.push(uid)
  params.push(documentId)

  const sql = `UPDATE project_documents SET ${fields.join(', ')} WHERE id = ?`
  const result = await execute<ResultSetHeader>(sql, params)

  if (result.affectedRows === 0) {
    throw createError({ statusCode: 404, message: '文档不存在' })
  }

  return {
    code: 0,
    message: '更新成功'
  }
})
