/**
 * 软删除规格书章节（功能模块/功能项）
 * DELETE /api/v1/requirement-contents/:contentId
 *
 * 规则：
 * - 仅允许删除“未设为需求项”的章节（含其子树）
 * - 仅做标记删除：status -> deprecated
 */
import type { ResultSetHeader, RowDataPacket } from '~~/server/utils/db'
import { assertProjectActive } from '~~/server/utils/projectLifecycle'

interface ContentRow extends RowDataPacket {
  id: number
  project_id: number
  status: string
  version_status: string
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

  const pool = useDbPool()
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()

    const [rows] = await connection.query<ContentRow[]>(
      `SELECT id, project_id, status, version_status
       FROM requirement_contents
       WHERE id = ?
       FOR UPDATE`,
      [contentId]
    )
    const content = rows[0]
    if (!content) {
      throw createError({ statusCode: 404, message: '章节不存在' })
    }

    await assertProjectActive(content.project_id)

    if (content.status === 'deprecated') {
      await connection.commit()
      return {
        code: 0,
        data: {
          changed: false,
          markedCount: 0
        }
      }
    }

    if (!['draft', 'baselined'].includes(content.version_status)) {
      throw createError({ statusCode: 409, message: '当前章节状态不允许删除' })
    }

    const [linkRows] = await connection.query<CountRow[]>(
      `WITH RECURSIVE subtree AS (
         SELECT id, parent_id
         FROM requirement_contents
         WHERE id = ? AND project_id = ?
         UNION ALL
         SELECT child.id, child.parent_id
         FROM requirement_contents child
         INNER JOIN subtree t ON child.parent_id = t.id
         WHERE child.project_id = ?
       )
       SELECT COUNT(*) AS cnt
       FROM subtree t
       INNER JOIN requirement_item_contents ric ON ric.content_id = t.id`,
      [contentId, content.project_id, content.project_id]
    )

    if ((linkRows[0]?.cnt || 0) > 0) {
      throw createError({ statusCode: 409, message: '已设为需求项的功能模块/功能项不允许删除' })
    }

    const [updateResult] = await connection.query<ResultSetHeader>(
      `WITH RECURSIVE subtree AS (
         SELECT id, parent_id
         FROM requirement_contents
         WHERE id = ? AND project_id = ?
         UNION ALL
         SELECT child.id, child.parent_id
         FROM requirement_contents child
         INNER JOIN subtree t ON child.parent_id = t.id
         WHERE child.project_id = ?
       )
       UPDATE requirement_contents c
       INNER JOIN subtree t ON t.id = c.id
       SET c.status = 'deprecated', c.updated_by = ?
       WHERE c.status != 'deprecated'`,
      [contentId, content.project_id, content.project_id, uid]
    )

    await connection.execute(
      `UPDATE project_documents
       SET import_status = 'imported_dirty'
       WHERE project_id = ?
         AND doc_category = 'requirement_spec'
         AND import_status = 'imported_clean'`,
      [content.project_id]
    )

    await connection.commit()

    return {
      code: 0,
      data: {
        changed: updateResult.affectedRows > 0,
        markedCount: updateResult.affectedRows
      }
    }
  } catch (err) {
    await connection.rollback()
    throw err
  } finally {
    connection.release()
  }
})
