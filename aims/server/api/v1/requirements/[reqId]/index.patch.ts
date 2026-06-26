/**
 * 编辑需求项
 * PATCH /api/v1/requirements/:reqId
 * Body: { title?, type?, category?, priority?, source?, milestoneId? }
 *
 * draft 态直接修改；baselined 态修改后自动转 change_pending
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface ReqRow extends RowDataPacket {
  id: number
  project_id: number
  status: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const reqId = Number(getRouterParam(event, 'reqId'))
  if (!reqId || Number.isNaN(reqId)) {
    throw createError({ statusCode: 400, message: '无效的需求ID' })
  }

  const req = await queryRow<ReqRow>(
    'SELECT id, project_id, status FROM requirement_items WHERE id = ?',
    [reqId]
  )
  if (!req) {
    throw createError({ statusCode: 404, message: '需求不存在' })
  }

  if (req.status === 'in_review' || req.status === 'change_pending') {
    throw createError({ statusCode: 409, message: '评审中的需求不允许编辑' })
  }
  if (req.status === 'deprecated') {
    throw createError({ statusCode: 409, message: '已废弃的需求不允许编辑' })
  }

  const body = await readBody(event)
  const updates: string[] = []
  const params: unknown[] = []

  if (body.title !== undefined) {
    if (!body.title?.trim()) {
      throw createError({ statusCode: 400, message: '标题不能为空' })
    }
    updates.push('title = ?')
    params.push(body.title.trim())
  }
  if (body.type !== undefined) {
    updates.push('type = ?')
    params.push(body.type === 'non_functional' ? 'non_functional' : 'functional')
  }
  if (body.category !== undefined) {
    updates.push('category = ?')
    params.push(body.category || null)
  }
  if (body.priority !== undefined && ['P0', 'P1', 'P2', 'P3'].includes(body.priority)) {
    updates.push('priority = ?')
    params.push(body.priority)
  }
  if (body.source !== undefined && ['customer', 'internal', 'compliance', 'regulation', 'other'].includes(body.source)) {
    updates.push('source = ?')
    params.push(body.source)
  }
  if (body.milestoneId !== undefined) {
    updates.push('milestone_id = ?')
    params.push(body.milestoneId || null)
  }

  if (updates.length === 0) {
    return { code: 0, data: { changed: false } }
  }

  updates.push('updated_by = ?')
  params.push(uid)

  if (req.status === 'baselined') {
    updates.push('status = \'change_pending\'')
  }

  params.push(reqId)
  await execute(
    `UPDATE requirement_items SET ${updates.join(', ')} WHERE id = ?`,
    params
  )

  await execute(
    `UPDATE project_documents SET import_status = 'imported_dirty'
     WHERE project_id = ? AND doc_category = 'requirement_spec' AND import_status = 'imported_clean'`,
    [req.project_id]
  )

  return {
    code: 0,
    data: {
      changed: true,
      newStatus: req.status === 'baselined' ? 'change_pending' : req.status
    }
  }
})
