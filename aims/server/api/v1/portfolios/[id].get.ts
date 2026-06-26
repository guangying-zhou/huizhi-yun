/**
 * 获取项目集详情（含子项目列表）
 * GET /api/v1/portfolios/:id
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface PortfolioRow extends RowDataPacket {
  id: number
  code: string
  name: string
  description: string | null
  domain_code: string | null
  owner_uid: string | null
  dept_code: string | null
  git_group: string | null
  is_product_line: number
  display_order: number
  status: string
  created_by: string
  created_at: string
  updated_at: string
}

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
  name: string
  category: string
  lifecycle_status: string
  leader_uid: string | null
  start_date: string | null
  end_date: string | null
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, message: '无效的项目集ID' })
  }

  const portfolio = await queryRow<PortfolioRow>(
    'SELECT * FROM project_portfolios WHERE id = ?',
    [id]
  )
  if (!portfolio) {
    throw createError({ statusCode: 404, message: '项目集不存在' })
  }

  const projects = await queryRows<ProjectRow[]>(
    `SELECT id, project_code, name, category, lifecycle_status, leader_uid, start_date, end_date
     FROM aims_projects
     WHERE portfolio_id = ?
       AND lifecycle_status != 'archived'
     ORDER BY updated_at DESC`,
    [id]
  )

  return {
    code: 0,
    data: {
      id: portfolio.id,
      code: portfolio.code,
      name: portfolio.name,
      description: portfolio.description,
      domainCode: portfolio.domain_code,
      ownerUid: portfolio.owner_uid,
      deptCode: portfolio.dept_code,
      gitGroup: portfolio.git_group,
      isProductLine: Boolean(portfolio.is_product_line),
      displayOrder: Number(portfolio.display_order || 0),
      status: portfolio.status,
      createdBy: portfolio.created_by,
      createdAt: portfolio.created_at,
      updatedAt: portfolio.updated_at,
      projects: projects.map(p => ({
        id: p.id,
        projectCode: p.project_code,
        name: p.name,
        category: p.category,
        lifecycleStatus: p.lifecycle_status,
        leaderUid: p.leader_uid,
        startDate: p.start_date,
        endDate: p.end_date
      }))
    }
  }
})
