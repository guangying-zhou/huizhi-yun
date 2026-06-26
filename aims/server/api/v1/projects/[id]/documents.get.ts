/**
 * 获取项目关联文档
 * GET /api/v1/projects/:id/documents
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface DocRow extends RowDataPacket {
  id: number
  uuid: string
  title: string
  doc_category: string | null
  codocs_uuid: string | null
  document_source: 'codocs' | 'repo'
  repo_project_code: string | null
  repo_file_path: string | null
  repo_commit_id: string | null
  created_by: string
  created_at: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const docs = await queryRows<DocRow[]>(
    `SELECT id, uuid, title, doc_category, codocs_uuid,
            document_source, repo_project_code, repo_file_path, repo_commit_id,
            created_by, created_at
     FROM project_documents
     WHERE project_id = ? AND work_item_id IS NULL AND is_folder = 0
     ORDER BY created_at ASC`,
    [id]
  )

  const mapDoc = (d: DocRow) => ({
    id: d.id,
    uuid: d.uuid,
    title: d.title,
    docCategory: d.doc_category,
    codocsUuid: d.codocs_uuid,
    documentSource: d.document_source || 'codocs',
    repoProjectCode: d.repo_project_code,
    repoFilePath: d.repo_file_path,
    repoCommitId: d.repo_commit_id,
    createdBy: d.created_by,
    createdAt: d.created_at
  })

  const proposal = docs.find(d => d.doc_category === 'project_proposal') || null

  return {
    code: 0,
    data: {
      documents: docs.map(mapDoc),
      proposal: proposal ? mapDoc(proposal) : null
    }
  }
})
