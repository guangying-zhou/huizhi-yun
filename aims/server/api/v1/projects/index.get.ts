/**
 * 获取项目列表
 * GET /api/v1/projects?category=&lifecycle_status=&search=&dept_code=&leader_uid=&page=&pageSize=
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { normalizeProjectRole } from '~~/app/utils/projectRoles'
import { hasGlobalProjectAdmin } from '~~/server/utils/projectPermission'

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
  name: string
  short_name: string
  internal_code: string | null
  description: string | null
  category: string
  methodology: string
  // item_key_prefix removed
  lifecycle_status: string
  portfolio_id: number | null
  domain_code: string | null
  dept_code: string | null
  leader_uid: string | null
  start_date: string | null
  end_date: string | null
  opp_id: number | null
  contract_id: number | null
  customer_code: string | null
  customer_name: string | null
  contract_code: string | null
  template_set_id: number | null
  template_version_id: number | null
  template_set_name: string | null
  template_version_label: string | null
  approval_status: string
  created_by: string
  created_at: string
  updated_at: string
  member_count: number
  current_member_role: string | null
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
  const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 20))
  const offset = (page - 1) * pageSize
  const globalProjectAdmin = await hasGlobalProjectAdmin(event)

  const conditions: string[] = []
  const params: unknown[] = []

  if (query.category) {
    conditions.push('p.category = ?')
    params.push(query.category)
  }

  if (query.lifecycle_status) {
    conditions.push('p.lifecycle_status = ?')
    params.push(query.lifecycle_status)
  } else {
    // 默认排除已归档项目
    conditions.push('p.lifecycle_status != \'archived\'')
  }

  if (query.search) {
    conditions.push('(p.name LIKE ? OR p.project_code LIKE ?)')
    const keyword = `%${query.search}%`
    params.push(keyword, keyword)
  }

  if (query.portfolioId !== undefined && String(query.portfolioId).trim() !== '') {
    const portfolioId = Number(query.portfolioId)
    if (portfolioId === 0) {
      conditions.push('p.portfolio_id IS NULL')
    } else {
      conditions.push('p.portfolio_id = ?')
      params.push(portfolioId)
    }
  }

  if (query.domainCode) {
    conditions.push('p.domain_code = ?')
    params.push(query.domainCode)
  }

  if (query.dept_code) {
    conditions.push('p.dept_code = ?')
    params.push(query.dept_code)
  }

  if (query.leader_uid) {
    conditions.push('p.leader_uid = ?')
    params.push(query.leader_uid)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // 查询总数
  const countSql = `SELECT COUNT(*) AS total FROM aims_projects p ${whereClause}`
  const countRow = await queryRow<CountRow>(countSql, params)
  const total = countRow?.total || 0

  // 查询列表（含成员数）
  const listSql = `
    SELECT p.*,
           ts.name AS template_set_name,
           tv.version_label AS template_version_label,
           IFNULL(mc.member_count, 0) AS member_count,
           cm.role AS current_member_role
    FROM aims_projects p
    LEFT JOIN project_template_sets ts ON ts.id = p.template_set_id
    LEFT JOIN project_template_versions tv ON tv.id = p.template_version_id
    LEFT JOIN (
      SELECT project_id, COUNT(*) AS member_count
      FROM aims_project_members
      GROUP BY project_id
    ) mc ON mc.project_id = p.id
    LEFT JOIN aims_project_members cm
      ON cm.project_id = p.id
     AND cm.uid = ?
     AND cm.status = 'active'
    ${whereClause}
    ORDER BY p.updated_at DESC
    LIMIT ? OFFSET ?
  `
  const listParams = [uid, ...params, pageSize, offset]
  const rows = await queryRows<ProjectRow[]>(listSql, listParams)

  const items = rows.map(row => ({
    id: row.id,
    projectCode: row.project_code,
    name: row.name,
    shortName: row.short_name,
    internalCode: row.internal_code,
    description: row.description,
    category: row.category,
    methodology: row.methodology,
    lifecycleStatus: row.lifecycle_status,
    portfolioId: row.portfolio_id,
    domainCode: row.domain_code,
    deptCode: row.dept_code,
    leaderUid: row.leader_uid,
    startDate: row.start_date,
    endDate: row.end_date,
    oppId: row.opp_id,
    contractId: row.contract_id,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    contractCode: row.contract_code,
    templateSetId: row.template_set_id,
    templateSetName: row.template_set_name,
    templateVersionId: row.template_version_id,
    templateVersionLabel: row.template_version_label,
    approvalStatus: row.approval_status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memberCount: row.member_count,
    canAccess: globalProjectAdmin || Boolean(row.current_member_role),
    currentUserRole: row.current_member_role
      ? normalizeProjectRole(row.current_member_role)
      : globalProjectAdmin ? 'manager' : null
  }))

  return {
    code: 0,
    data: {
      items,
      total,
      page,
      pageSize
    }
  }
})
