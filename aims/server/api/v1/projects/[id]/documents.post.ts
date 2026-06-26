/**
 * 为项目关联立项书（或其它项目级文档）
 * POST /api/v1/projects/:id/documents
 *
 * 支持两种来源（由 body.source 指定；缺省 codocs，向后兼容）
 */
import type { ResultSetHeader, RowDataPacket } from '~~/server/utils/db'
import { findDuplicateProjectDoc, resolveDocumentBinding } from '~~/server/utils/projectDocumentBinding'
import type { DocumentBindingPayload } from '~~/server/utils/projectDocumentBinding'
import { getCodocsDocumentSummary } from '~~/server/utils/codocsApi'

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
  dept_code: string | null
  leader_uid: string | null
  created_by: string
}

interface PostBody extends DocumentBindingPayload {
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

  const body = await readBody<PostBody>(event)
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
    throw createError({ statusCode: 403, message: '无权为该项目绑定文档' })
  }

  const binding = await resolveDocumentBinding(body, event)

  // codocs：保留原有"部门一致性"校验
  if (binding.source === 'codocs' && binding.codocsUuid) {
    const summary = await getCodocsDocumentSummary(binding.codocsUuid, event)
    if (!project.dept_code || summary.data.deptCode !== project.dept_code) {
      throw createError({ statusCode: 403, message: '文档所属部门与项目负责人部门不一致' })
    }
  }

  const dupId = await findDuplicateProjectDoc(id, binding)
  if (dupId) {
    throw createError({ statusCode: 409, message: '该文档已关联到项目' })
  }

  const result = await execute<ResultSetHeader>(
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
      id: result.insertId,
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
