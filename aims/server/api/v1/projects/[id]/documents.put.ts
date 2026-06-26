/**
 * 变更项目立项书
 * PUT /api/v1/projects/:id/documents
 *
 * 支持两种来源（由 body.source 指定；缺省 codocs，向后兼容）：
 *   - codocs: { source:'codocs', codocsUuid|documentId, title? }
 *   - repo:   { source:'repo', repoProjectCode, repoFilePath, repoCommitId?, title? }
 */
import type { ResultSetHeader, RowDataPacket } from '~~/server/utils/db'
import { resolveDocumentBinding } from '~~/server/utils/projectDocumentBinding'
import type { DocumentBindingPayload } from '~~/server/utils/projectDocumentBinding'

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
  dept_code: string | null
  leader_uid: string | null
  created_by: string
}

interface PutBody extends DocumentBindingPayload {
  /** 向后兼容：旧版本使用 documentId 传 codocs UUID */
  documentId?: string
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

  const body = await readBody<PutBody>(event)
  // 向后兼容：未指定 source 且传了 documentId → codocs
  if (!body.source && body.documentId) {
    body.source = 'codocs'
    body.codocsUuid = body.documentId
  }

  const project = await queryRow<ProjectRow>(
    'SELECT id, project_code, dept_code, leader_uid, created_by FROM aims_projects WHERE id = ?',
    [id]
  )
  if (!project) {
    throw createError({ statusCode: 404, message: '项目不存在' })
  }
  if (project.created_by !== uid && project.leader_uid !== uid) {
    throw createError({ statusCode: 403, message: '无权变更立项书' })
  }

  const binding = await resolveDocumentBinding(body, event)

  // 删除旧的立项书关联
  await execute<ResultSetHeader>(
    `DELETE FROM project_documents
     WHERE project_id = ? AND work_item_id IS NULL AND doc_category = 'project_proposal'`,
    [id]
  )

  // 插入新关联
  await execute<ResultSetHeader>(
    `INSERT INTO project_documents
      (uuid, project_id, project_code, parent_id, title, doc_category, is_folder,
       codocs_uuid, document_source, repo_project_code, repo_file_path, repo_commit_id,
       content_size, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, 'project_proposal', 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      id,
      project.project_code,
      null,
      binding.title,
      binding.codocsUuid,
      binding.source,
      binding.repoProjectCode,
      binding.repoFilePath,
      binding.repoCommitId,
      binding.contentSize,
      uid,
      uid
    ]
  )

  return {
    code: 0,
    data: {
      projectId: id,
      source: binding.source,
      title: binding.title,
      codocsUuid: binding.codocsUuid,
      repoProjectCode: binding.repoProjectCode,
      repoFilePath: binding.repoFilePath,
      repoCommitId: binding.repoCommitId
    }
  }
})
