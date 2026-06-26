/**
 * 编辑章节标题/正文
 * PATCH /api/v1/requirement-contents/:contentId
 * Body: { title?, contentMd? }
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface ContentRow extends RowDataPacket {
  id: number
  project_id: number
  status: string
}

interface CountRow extends RowDataPacket {
  cnt: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const contentId = Number(getRouterParam(event, 'contentId'))
  if (!contentId || Number.isNaN(contentId)) {
    throw createError({ statusCode: 400, message: '无效的章节ID' })
  }

  const content = await queryRow<ContentRow>(
    'SELECT id, project_id, status FROM requirement_contents WHERE id = ?',
    [contentId]
  )
  if (!content) {
    throw createError({ statusCode: 404, message: '章节不存在' })
  }
  if (content.status === 'deprecated') {
    throw createError({ statusCode: 409, message: '已废弃的章节不允许编辑' })
  }

  const body = await readBody(event)
  const touchesContent = body.title !== undefined || body.contentMd !== undefined

  if (touchesContent) {
    const lockedLinkedRequirement = await queryRow<CountRow>(
      `WITH RECURSIVE descendants AS (
         SELECT id, parent_id
         FROM requirement_contents
         WHERE id = ?
         UNION ALL
         SELECT c.id, c.parent_id
         FROM requirement_contents c
         INNER JOIN descendants t ON c.parent_id = t.id
       ),
       ancestors AS (
         SELECT id, parent_id
         FROM requirement_contents
         WHERE id = ?
         UNION ALL
         SELECT p.id, p.parent_id
         FROM requirement_contents p
         INNER JOIN ancestors t ON t.parent_id = p.id
       ),
       content_scope AS (
         SELECT id FROM descendants
         UNION
         SELECT id FROM ancestors
       )
       SELECT COUNT(*) AS cnt
       FROM content_scope ct
       INNER JOIN requirement_item_contents ric ON ric.content_id = ct.id
       INNER JOIN requirement_items r ON r.id = ric.requirement_id
       WHERE r.status IN ('in_review', 'baselined', 'change_pending')`,
      [contentId, contentId]
    )
    if ((lockedLinkedRequirement?.cnt || 0) > 0) {
      throw createError({ statusCode: 409, message: '需求已进入评审批次，对应章节不允许编辑或取消关联' })
    }
  }

  const updates: string[] = []
  const params: unknown[] = []

  if (body.title !== undefined) {
    updates.push('title = ?')
    params.push(body.title.trim())
  }
  if (body.contentMd !== undefined) {
    updates.push('content_md = ?')
    params.push(body.contentMd)
  }
  if (updates.length === 0) {
    return { code: 0, data: { changed: false } }
  }

  if (body.title !== undefined || body.contentMd !== undefined) {
    updates.push('status = \'modified\'')
  }
  updates.push('updated_by = ?')
  params.push(uid)
  params.push(contentId)

  await execute(
    `UPDATE requirement_contents SET ${updates.join(', ')} WHERE id = ?`,
    params
  )

  await execute(
    `UPDATE project_documents SET import_status = 'imported_dirty'
     WHERE project_id = ? AND doc_category = 'requirement_spec' AND import_status = 'imported_clean'`,
    [content.project_id]
  )

  return { code: 0, data: { changed: true } }
})
