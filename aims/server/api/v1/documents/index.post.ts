/**
 * 创建文档/文件夹
 * POST /api/v1/documents
 *
 * 文档（非文件夹）创建时自动调 Codocs API 创建对应文档，回填 codocs_uuid
 * OSS 路径由 Codocs 生成: codocs/projects/{projectCode}/docs/{folderPath}/{title}.md
 */
import type { ResultSetHeader, RowDataPacket } from '~~/server/utils/db'
import { createCodocsDocument } from '~~/server/utils/codocsApi'
import { resolveDocumentOwnerContext } from '~~/server/utils/documentOwners'

interface DocRow extends RowDataPacket {
  id: number
  title: string
  is_folder: number
  parent_id: number | null
}

/**
 * 递归获取文件夹路径（从叶子到根）
 * 例如：parentId=5 → "需求文档/子目录"
 */
async function getFolderPath(parentId: number): Promise<string> {
  const parts: string[] = []
  let currentId: number | null = parentId

  while (currentId) {
    const row: DocRow | null = await queryRow<DocRow>(
      'SELECT id, title, is_folder, parent_id FROM project_documents WHERE id = ? AND is_folder = 1',
      [currentId]
    )
    if (!row) break
    parts.unshift(row.title)
    currentId = row.parent_id
  }

  return parts.join('/')
}
export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const body = await readBody(event)

  if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
    throw createError({ statusCode: 400, message: '标题不能为空' })
  }

  const uuid = crypto.randomUUID()
  const isFolder = body.isFolder ? 1 : 0
  const owner = await resolveDocumentOwnerContext(body)
  const parentId = body.parentId ? Number(body.parentId) : null

  // 非文件夹时自动在 Codocs 创建同 uuid 的文档
  if (!isFolder) {
    try {
      const folderPath = parentId ? await getFolderPath(parentId) : ''

      await createCodocsDocument({
        uuid,
        title: body.title.trim(),
        ownerUid: uid,
        content: '',
        docType: 'project',
        projectCode: owner.projectCode || '',
        folderPath
      })
    } catch (err: unknown) {
      const e = err as { message?: string }
      console.error('[Documents] Failed to create Codocs document:', e.message || err)
    }
  }

  const sql = `
    INSERT INTO project_documents
      (uuid, portfolio_id, project_id, project_code, milestone_id, work_item_id, parent_id,
       title, doc_category, is_folder, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  const params = [
    uuid,
    owner.portfolioId,
    owner.projectId,
    owner.projectCode,
    owner.milestoneId,
    owner.workItemId,
    parentId,
    body.title.trim(),
    body.docCategory || null,
    isFolder,
    uid,
    uid
  ]

  const result = await execute<ResultSetHeader>(sql, params)

  return {
    code: 0,
    data: {
      id: result.insertId,
      uuid,
      title: body.title.trim(),
      isFolder: Boolean(isFolder)
    }
  }
})
