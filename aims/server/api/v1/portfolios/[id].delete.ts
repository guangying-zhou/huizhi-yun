/**
 * 删除项目集
 * DELETE /api/v1/portfolios/:id
 * 关联的项目 portfolio_id 会被数据库 ON DELETE SET NULL 自动置空
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { requireRole } from '~~/server/utils/checkPermission'

interface PortfolioRow extends RowDataPacket {
  id: number
}

interface ProjectCountRow extends RowDataPacket {
  cnt: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }
  await requireRole(event, 'aims:admin', '仅 AIMS 管理员可以删除项目集')

  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的项目集ID' })
  }

  const portfolio = await queryRow<PortfolioRow>(
    'SELECT id FROM project_portfolios WHERE id = ?',
    [id]
  )
  if (!portfolio) {
    throw createError({ statusCode: 404, message: '项目集不存在' })
  }

  const projectCount = await queryRow<ProjectCountRow>(
    'SELECT COUNT(*) AS cnt FROM aims_projects WHERE portfolio_id = ? AND lifecycle_status != \'archived\'',
    [id]
  )
  if ((projectCount?.cnt || 0) > 0) {
    throw createError({ statusCode: 400, message: '项目集下仍有关联项目，无法删除' })
  }

  await execute('DELETE FROM project_portfolios WHERE id = ?', [id])

  return { code: 0, data: null }
})
