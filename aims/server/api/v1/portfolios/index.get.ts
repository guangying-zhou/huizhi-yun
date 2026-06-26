/**
 * 获取项目集列表
 * GET /api/v1/portfolios?status=&domainCode=&deptCode=&search=&page=&pageSize=
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
  project_count: number
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))
  const offset = (page - 1) * pageSize

  const conditions: string[] = []
  const params: unknown[] = []

  if (query.status) {
    conditions.push('pf.status = ?')
    params.push(query.status)
  } else {
    conditions.push('pf.status = \'active\'')
  }

  if (query.domainCode) {
    conditions.push('pf.domain_code = ?')
    params.push(query.domainCode)
  }

  if (query.deptCode) {
    conditions.push('pf.dept_code = ?')
    params.push(query.deptCode)
  }

  if (query.search) {
    conditions.push('pf.name LIKE ?')
    params.push(`%${query.search}%`)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const countRow = await queryRow<CountRow>(
    `SELECT COUNT(*) AS total FROM project_portfolios pf ${whereClause}`,
    params
  )
  const total = countRow?.total || 0

  const listSql = `
    SELECT pf.*,
           IFNULL(pc.project_count, 0) AS project_count
    FROM project_portfolios pf
    LEFT JOIN (
      SELECT portfolio_id, COUNT(*) AS project_count
      FROM aims_projects
      WHERE portfolio_id IS NOT NULL
        AND lifecycle_status != 'archived'
      GROUP BY portfolio_id
    ) pc ON pc.portfolio_id = pf.id
    ${whereClause}
    ORDER BY pf.display_order ASC, pf.id ASC
    LIMIT ? OFFSET ?
  `
  const rows = await queryRows<PortfolioRow[]>(listSql, [...params, pageSize, offset])

  return {
    code: 0,
    data: {
      items: rows.map(row => ({
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        domainCode: row.domain_code,
        ownerUid: row.owner_uid,
        deptCode: row.dept_code,
        gitGroup: row.git_group,
        isProductLine: Boolean(row.is_product_line),
        displayOrder: Number(row.display_order || 0),
        status: row.status,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        projectCount: Number(row.project_count || 0)
      })),
      total,
      page,
      pageSize
    }
  }
})
