/**
 * 更新交付物证据/状态
 * PATCH /api/v1/work-items/:id/deliverables/:deliverableId
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface DeliverableRow extends RowDataPacket {
  id: number
  target_id: number | null
  matter_id: number | null
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const workItemId = Number(getRouterParam(event, 'id'))
  const deliverableId = Number(getRouterParam(event, 'deliverableId'))
  if (!workItemId || !deliverableId) {
    throw createError({ statusCode: 400, message: '参数无效' })
  }

  const body = await readBody<{
    evidenceUrl?: string | null
    evidenceNote?: string | null
    status?: string
    documentUuid?: string | null
    documentTitle?: string | null
    documentSource?: 'codocs' | 'repo' | null
    repoProjectCode?: string | null
    repoFilePath?: string | null
    repoCommitId?: string | null
  }>(event)

  const hasCodocsBinding = (body.documentSource === 'codocs' && !!body.documentUuid)
    || (!!body.documentUuid && body.documentUuid !== '')
  const hasRepoBinding = (body.documentSource === 'repo' && !!body.repoProjectCode && !!body.repoFilePath)
    || (!!body.repoProjectCode && !!body.repoFilePath)
  const shouldAutoSubmitDocument = !body.status && (hasCodocsBinding || hasRepoBinding)

  const deliverable = await queryRow<DeliverableRow>(
    `SELECT id, target_id, matter_id
     FROM deliverables
     WHERE id = ? AND (target_id = ? OR matter_id = ?)`,
    [deliverableId, workItemId, workItemId]
  )
  if (!deliverable) {
    throw createError({ statusCode: 404, message: '交付物不存在' })
  }

  const fields: string[] = []
  const values: unknown[] = []

  if (body.evidenceUrl !== undefined) {
    fields.push('evidence_url = ?')
    values.push(body.evidenceUrl || null)
  }
  if (body.evidenceNote !== undefined) {
    fields.push('evidence_note = ?')
    values.push(body.evidenceNote || null)
  }
  if (body.documentUuid !== undefined) {
    fields.push('document_uuid = ?')
    values.push(body.documentUuid || null)
  }
  if (body.documentTitle !== undefined) {
    fields.push('document_title = ?')
    values.push(body.documentTitle || null)
  }
  if (body.documentSource !== undefined) {
    fields.push('document_source = ?')
    values.push(body.documentSource || 'codocs')
  }
  if (body.repoProjectCode !== undefined) {
    fields.push('repo_project_code = ?')
    values.push(body.repoProjectCode || null)
  }
  if (body.repoFilePath !== undefined) {
    fields.push('repo_file_path = ?')
    values.push(body.repoFilePath || null)
  }
  if (body.repoCommitId !== undefined) {
    fields.push('repo_commit_id = ?')
    values.push(body.repoCommitId || null)
  }
  if (body.status) {
    const allowed = ['pending', 'submitted', 'approved', 'rejected']
    if (!allowed.includes(body.status)) {
      throw createError({ statusCode: 400, message: `status 必须是 ${allowed.join('/')} 之一` })
    }
    fields.push('status = ?')
    values.push(body.status)
    if (body.status === 'submitted') {
      fields.push('submitted_by = ?', 'submitted_at = CURRENT_TIMESTAMP')
      values.push(uid)
    }
  }
  if (shouldAutoSubmitDocument) {
    fields.push('status = ?', 'submitted_by = ?', 'submitted_at = CURRENT_TIMESTAMP')
    values.push('submitted', uid)
  }

  if (fields.length === 0) {
    return { code: 0, data: null }
  }

  fields.push('updated_at = CURRENT_TIMESTAMP')
  values.push(deliverableId)

  await execute(
    `UPDATE deliverables SET ${fields.join(', ')} WHERE id = ?`,
    values
  )

  return { code: 0, data: null }
})
