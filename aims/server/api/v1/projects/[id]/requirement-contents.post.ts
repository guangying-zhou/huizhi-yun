/**
 * 新增需求规格书内容（不自动创建需求项）
 * POST /api/v1/projects/:id/requirement-contents
 * Body: { kind: 'module'|'item', title, contentMd?, headingDepth, parentId? }
 */
import { createRequirementContent } from '~~/server/utils/requirementContentCreate'
import { useDbPool } from '~~/server/utils/db'
import { assertProjectActive } from '~~/server/utils/projectLifecycle'

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
  const kind = body.kind === 'module' ? 'module' : 'item'
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) {
    throw createError({ statusCode: 400, message: '标题不能为空' })
  }

  const headingDepth = Number(body.headingDepth)
  if (!Number.isInteger(headingDepth) || headingDepth < 2 || headingDepth > 6) {
    throw createError({ statusCode: 400, message: '无效的标题层级' })
  }

  const parentId = Number.isInteger(body.parentId) && body.parentId > 0 ? Number(body.parentId) : null
  if (kind === 'item' && !parentId) {
    throw createError({ statusCode: 400, message: '新增功能项必须指定所属功能模块' })
  }

  const connection = await useDbPool().getConnection()
  try {
    await connection.beginTransaction()

    if (parentId) {
      const [parentRows] = await connection.query<(import('~~/server/utils/db').RowDataPacket & {
        id: number
        project_id: number
      })[]>(
        'SELECT id, project_id FROM requirement_contents WHERE id = ? LIMIT 1',
        [parentId]
      )
      const parent = parentRows[0]
      if (!parent || parent.project_id !== projectId) {
        throw createError({ statusCode: 400, message: '所属章节无效' })
      }
    }

    const result = await createRequirementContent(connection, {
      projectId,
      uid,
      kind,
      title,
      contentMd: typeof body.contentMd === 'string' ? body.contentMd : '',
      headingDepth,
      parentId
    })

    await connection.execute(
      `UPDATE project_documents SET import_status = 'imported_dirty'
       WHERE project_id = ? AND doc_category = 'requirement_spec' AND import_status = 'imported_clean'`,
      [projectId]
    )

    await connection.commit()

    return {
      code: 0,
      data: {
        id: result.id,
        title: result.title,
        childContentIds: result.childContentIds
      }
    }
  } catch (err) {
    await connection.rollback()
    throw err
  } finally {
    connection.release()
  }
})
