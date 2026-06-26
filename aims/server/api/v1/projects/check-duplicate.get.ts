/**
 * 检查项目名称或编码是否重复
 * GET /api/v1/projects/check-duplicate?name=&projectCode=
 * 返回 { nameExists, codeExists }
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface CountRow extends RowDataPacket {
  cnt: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const query = getQuery(event)
  const name = query.name as string | undefined
  const projectCode = query.projectCode as string | undefined

  let nameExists = false
  let codeExists = false

  if (name) {
    const row = await queryRow<CountRow>(
      'SELECT COUNT(*) AS cnt FROM aims_projects WHERE name = ? AND lifecycle_status != \'archived\'',
      [name]
    )
    nameExists = (row?.cnt || 0) > 0
  }

  if (projectCode) {
    const row = await queryRow<CountRow>(
      'SELECT COUNT(*) AS cnt FROM aims_projects WHERE project_code = ? AND lifecycle_status != \'archived\'',
      [projectCode]
    )
    codeExists = (row?.cnt || 0) > 0
  }

  return {
    code: 0,
    data: { nameExists, codeExists }
  }
})
