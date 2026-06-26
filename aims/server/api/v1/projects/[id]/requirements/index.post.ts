/**
 * 新建需求项（draft 态）
 * POST /api/v1/projects/:id/requirements
 * Body: { title, type, category?, priority?, source?, milestoneId?, contentIds?: number[], content?: { kind, parentId?, headingDepth?, contentMd? } }
 *   - contentIds: 创建后同事务关联到这些规格书章节（批量打包）
 */
import type { ResultSetHeader, RowDataPacket } from '~~/server/utils/db'
import { getRequirementBaselineWorkItemId } from '~~/server/utils/requirementTarget'
import { assertProjectActive } from '~~/server/utils/projectLifecycle'
import { nextRequirementCode } from '~~/server/utils/requirementCode'

function isRetryableTxnError(err: unknown): boolean {
  const code = (err as { code?: string })?.code
  return code === 'ER_LOCK_WAIT_TIMEOUT' || code === 'ER_LOCK_DEADLOCK' || code === 'ER_DUP_ENTRY'
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const projectId = Number(getRouterParam(event, 'id'))
  if (!projectId || Number.isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  await assertProjectActive(projectId)

  const body = await readBody(event)
  if (!body.title?.trim()) {
    throw createError({ statusCode: 400, message: '需求标题不能为空' })
  }

  const type = body.type === 'non_functional' ? 'non_functional' : 'functional'
  const priority = ['P0', 'P1', 'P2', 'P3'].includes(body.priority) ? body.priority : 'P2'
  const source = ['customer', 'internal', 'compliance', 'regulation', 'other'].includes(body.source) ? body.source : 'internal'
  const scopeNote = typeof body.scopeNote === 'string' && body.scopeNote.trim()
    ? body.scopeNote.trim().slice(0, 2000)
    : null
  const contentPayload = body.content && typeof body.content === 'object' ? body.content : null
  const rawContentIds = Array.isArray(body.contentIds) ? body.contentIds : []
  const contentIds = rawContentIds
    .map((v: unknown) => Number(v))
    .filter((n: number) => Number.isInteger(n) && n > 0)

  const createContentKind = contentPayload?.kind === 'module' ? 'module' : (contentPayload?.kind === 'item' ? 'item' : null)
  const createContentParentId = Number.isInteger(contentPayload?.parentId) && contentPayload.parentId > 0
    ? Number(contentPayload.parentId)
    : null
  const createContentHeadingDepth = Number.isInteger(contentPayload?.headingDepth) && contentPayload.headingDepth >= 2 && contentPayload.headingDepth <= 6
    ? Number(contentPayload.headingDepth)
    : null
  const createContentMd = typeof contentPayload?.contentMd === 'string'
    ? contentPayload.contentMd.trim()
    : ''

  if (createContentKind && contentIds.length > 0) {
    throw createError({ statusCode: 400, message: '不能同时关联已有章节并创建新章节' })
  }
  if (createContentKind && !createContentHeadingDepth) {
    throw createError({ statusCode: 400, message: '缺少新增章节标题层级' })
  }
  if (createContentKind === 'item' && !createContentParentId) {
    throw createError({ statusCode: 400, message: '新增功能项必须选择所属功能模块' })
  }

  const pool = useDbPool()
  const maxAttempts = 3

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()

      let createParentRequirementLocked = false
      let resolvedContentParentId: number | null = createContentParentId
      if (createContentKind) {
        if (createContentParentId) {
          const [parentRows] = await connection.query<(RowDataPacket & {
            id: number
            project_id: number
            parent_id: number | null
            heading_depth: number
            version_status: string
          })[]>(
            `SELECT id, project_id, parent_id, heading_depth, version_status
             FROM requirement_contents
             WHERE id = ?
             LIMIT 1`,
            [createContentParentId]
          )
          const parentRow = parentRows[0]
          if (!parentRow || parentRow.project_id !== projectId || parentRow.version_status !== 'draft') {
            throw createError({ statusCode: 400, message: '新增章节的父节点无效' })
          }
          const [lockedRows] = await connection.query<(RowDataPacket & { cnt: number })[]>(
            `WITH RECURSIVE parent_scope AS (
               SELECT id, parent_id
               FROM requirement_contents
               WHERE id = ?
               UNION ALL
               SELECT p.id, p.parent_id
               FROM requirement_contents p
               INNER JOIN parent_scope s ON s.parent_id = p.id
             )
             SELECT COUNT(*) AS cnt
             FROM parent_scope ps
             INNER JOIN requirement_item_contents ric ON ric.content_id = ps.id
             INNER JOIN requirement_items r ON r.id = ric.requirement_id
             WHERE r.status IN ('in_review', 'baselined', 'change_pending')`,
            [createContentParentId]
          )
          createParentRequirementLocked = (lockedRows[0]?.cnt || 0) > 0
          if (createParentRequirementLocked) {
            throw createError({ statusCode: 409, message: '所属模块已进入评审批次，无法新增需求' })
          }
          if (createContentKind === 'module' && createContentHeadingDepth) {
            if (parentRow.heading_depth === createContentHeadingDepth - 1) {
              resolvedContentParentId = parentRow.id
            } else if (parentRow.heading_depth === createContentHeadingDepth) {
              resolvedContentParentId = parentRow.parent_id
            } else {
              resolvedContentParentId = parentRow.parent_id
            }
          }
        } else if (createContentKind === 'module') {
          resolvedContentParentId = null
        }
      }

      if (contentIds.length > 0) {
        const placeholders = contentIds.map(() => '?').join(',')
        const [lockedRows] = await connection.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS cnt
           FROM requirement_item_contents ric
           INNER JOIN requirement_contents c ON c.id = ric.content_id
           INNER JOIN requirement_items r ON r.id = ric.requirement_id
           WHERE c.id IN (${placeholders})
             AND r.status IN ('in_review', 'baselined', 'change_pending')`,
          contentIds
        )
        if (((lockedRows[0] as { cnt?: number } | undefined)?.cnt || 0) > 0) {
          throw createError({ statusCode: 409, message: '所选章节已关联评审中的需求，无法重新关联' })
        }
      }

      // 将编号生成放在校验之后，缩短事务持锁窗口，降低锁等待概率
      const { reqNumber, reqCode } = await nextRequirementCode(connection, projectId)

      // 指定 workItemId 则使用，否则回落到基线 target（研发类项目会有；其他项目为 null）
      const workItemId = Number.isInteger(body.workItemId) && body.workItemId > 0
        ? Number(body.workItemId)
        : await getRequirementBaselineWorkItemId(projectId, connection)

      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO requirement_items
         (project_id, req_number, req_code, title, type, category, priority, source, milestone_id, work_item_id, scope_note, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
        [projectId, reqNumber, reqCode, body.title.trim(), type, body.category || null, priority, source, body.milestoneId || null, workItemId, scopeNote, uid]
      )

      if (createContentKind) {
        const siblingParams: unknown[] = [projectId]
        let siblingSql = 'SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM requirement_contents WHERE project_id = ?'
        if (resolvedContentParentId == null) {
          siblingSql += ' AND parent_id IS NULL'
        } else {
          siblingSql += ' AND parent_id = ?'
          siblingParams.push(resolvedContentParentId)
        }
        const [sortRows] = await connection.query<(RowDataPacket & { max_sort: number })[]>(siblingSql, siblingParams)
        const nextSortOrder = Number(sortRows[0]?.max_sort ?? -1) + 1

        const [contentResult] = await connection.execute<ResultSetHeader>(
          `INSERT INTO requirement_contents
           (content_original_id, version_no, version_status, project_id, parent_id, heading_depth,
            title, content_md, sort_order, status, created_by, updated_by)
           VALUES (NULL, 1, 'draft', ?, ?, ?, ?, ?, ?, 'modified', ?, ?)`,
          [
            projectId,
            resolvedContentParentId,
            createContentHeadingDepth,
            body.title.trim(),
            createContentMd || null,
            nextSortOrder,
            uid,
            uid
          ]
        )
        await connection.execute(
          'UPDATE requirement_contents SET content_original_id = ? WHERE id = ?',
          [contentResult.insertId, contentResult.insertId]
        )
        await connection.execute(
          `INSERT INTO requirement_item_contents
           (requirement_id, content_id, relation_type, sort_order, created_by)
           VALUES (?, ?, 'baseline', 0, ?)`,
          [result.insertId, contentResult.insertId, uid]
        )

        await connection.execute(
          `UPDATE project_documents SET import_status = 'imported_dirty'
           WHERE project_id = ? AND doc_category = 'requirement_spec' AND import_status IN ('imported_clean', 'imported_locked')`,
          [projectId]
        )
      } else if (contentIds.length > 0) {
        for (let i = 0; i < contentIds.length; i++) {
          await connection.execute(
            `INSERT IGNORE INTO requirement_item_contents
             (requirement_id, content_id, relation_type, sort_order, created_by)
             VALUES (?, ?, 'baseline', ?, ?)`,
            [result.insertId, contentIds[i], i, uid]
          )
        }

        await connection.execute(
          `UPDATE project_documents SET import_status = 'imported_dirty'
           WHERE project_id = ? AND doc_category = 'requirement_spec' AND import_status = 'imported_clean'`,
          [projectId]
        )
      }

      await connection.commit()

      return {
        code: 0,
        data: {
          id: result.insertId,
          reqNumber,
          reqCode,
          title: body.title.trim(),
          type,
          priority,
          source,
          status: 'draft'
        }
      }
    } catch (err) {
      await connection.rollback()
      if (isRetryableTxnError(err) && attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, attempt * 120))
        continue
      }
      throw err
    } finally {
      connection.release()
    }
  }

  throw createError({ statusCode: 500, message: '创建需求项失败，请重试' })
})
