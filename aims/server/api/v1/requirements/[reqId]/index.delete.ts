/**
 * 删除/废弃需求项
 * DELETE /api/v1/requirements/:reqId
 *
 * draft 态硬删除；其他态软删（status → deprecated）
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface ReqRow extends RowDataPacket {
  id: number
  project_id: number
  status: string
  item_kind: string
  parent_requirement_id: number | null
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

  const pool = useDbPool()
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()

    const [reqRows] = await connection.query<ReqRow[]>(
      `SELECT id, project_id, status, item_kind, parent_requirement_id
       FROM requirement_items
       WHERE id = ?
       FOR UPDATE`,
      [reqId]
    )
    const req = reqRows[0]
    if (!req) {
      throw createError({ statusCode: 404, message: '需求不存在' })
    }

    if (req.status === 'baselined') {
      throw createError({ statusCode: 409, message: '已基线的需求不允许删除或废弃' })
    }

    if (req.status === 'in_review' || req.status === 'change_pending') {
      throw createError({ statusCode: 409, message: '评审中的需求不允许删除' })
    }

    if (req.item_kind === 'change' && req.parent_requirement_id) {
      // 变更需求绑定的是“完整内容集合”。删除时只清除由该变更新增的内容版本，
      // 复用的当前基线内容仍归原需求所有，不能被删除或改状态。
      await connection.execute(
        `DELETE c
         FROM requirement_contents c
         INNER JOIN requirement_item_contents ric
           ON ric.content_id = c.id
          AND ric.requirement_id = ?
          AND ric.relation_type = 'change'
         LEFT JOIN requirement_item_contents parent_ric
           ON parent_ric.requirement_id = ?
          AND parent_ric.content_id = c.id
          AND parent_ric.relation_type = 'baseline'
         WHERE parent_ric.id IS NULL
           AND c.version_status IN ('change_draft', 'in_review', 'archived')`,
        [reqId, req.parent_requirement_id]
      )
    }

    // 两种路径都要解绑章节，否则规格书左侧章节树仍显示"已绑定需求项"
    await connection.execute(
      'DELETE FROM requirement_item_contents WHERE requirement_id = ?',
      [reqId]
    )

    if (req.status === 'draft') {
      await connection.execute('DELETE FROM requirement_items WHERE id = ?', [reqId])
    } else {
      await connection.execute(
        'UPDATE requirement_items SET status = \'deprecated\', updated_by = ? WHERE id = ?',
        [uid, reqId]
      )
    }

    await connection.execute(
      `UPDATE project_documents SET import_status = 'imported_dirty'
       WHERE project_id = ? AND doc_category = 'requirement_spec' AND import_status = 'imported_clean'`,
      [req.project_id]
    )

    await connection.commit()

    return { code: 0, data: { deleted: req.status === 'draft', deprecated: req.status !== 'draft' } }
  } catch (err) {
    await connection.rollback()
    throw err
  } finally {
    connection.release()
  }
})
