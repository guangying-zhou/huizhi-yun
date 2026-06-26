/**
 * 系统管理员项目管理列表
 * GET /api/v1/admin/projects
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { requireGlobalProjectAdmin } from '~~/server/utils/projectPermission'

interface ProjectAdminRow extends RowDataPacket {
  id: number
  project_code: string
  name: string
  short_name: string
  internal_code: string | null
  description: string | null
  category: string
  methodology: string
  lifecycle_status: string
  portfolio_id: number | null
  portfolio_name: string | null
  domain_code: string | null
  dept_code: string | null
  leader_uid: string | null
  start_date: string | null
  end_date: string | null
  customer_name: string | null
  contract_code: string | null
  template_set_name: string | null
  template_version_label: string | null
  created_by: string
  created_at: string
  updated_at: string
  member_count: number
  repo_count: number
  milestone_count: number
  work_item_count: number
  requirement_count: number
  document_count: number
  deliverable_count: number
  approval_count: number
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  await requireGlobalProjectAdmin(event)

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))
  const offset = (page - 1) * pageSize

  const conditions: string[] = []
  const params: unknown[] = []

  if (query.search) {
    conditions.push('(p.project_code LIKE ? OR p.name LIKE ? OR p.short_name LIKE ? OR p.leader_uid LIKE ?)')
    const keyword = `%${query.search}%`
    params.push(keyword, keyword, keyword, keyword)
  }

  if (query.category && query.category !== 'all') {
    conditions.push('p.category = ?')
    params.push(query.category)
  }

  if (query.lifecycleStatus && query.lifecycleStatus !== 'all') {
    conditions.push('p.lifecycle_status = ?')
    params.push(query.lifecycleStatus)
  }

  if (query.portfolioId !== undefined && String(query.portfolioId).trim() !== '' && query.portfolioId !== 'all') {
    const portfolioId = Number(query.portfolioId)
    if (portfolioId === 0) {
      conditions.push('p.portfolio_id IS NULL')
    } else {
      conditions.push('p.portfolio_id = ?')
      params.push(portfolioId)
    }
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const countRow = await queryRow<CountRow>(`SELECT COUNT(*) AS total FROM aims_projects p ${whereClause}`, params)
  const total = Number(countRow?.total || 0)

  const rows = await queryRows<ProjectAdminRow[]>(
    `
      SELECT
        p.id,
        p.project_code,
        p.name,
        p.short_name,
        p.internal_code,
        p.description,
        p.category,
        p.methodology,
        p.lifecycle_status,
        p.portfolio_id,
        pf.name AS portfolio_name,
        p.domain_code,
        p.dept_code,
        p.leader_uid,
        p.start_date,
        p.end_date,
        p.customer_name,
        p.contract_code,
        ts.name AS template_set_name,
        tv.version_label AS template_version_label,
        p.created_by,
        p.created_at,
        p.updated_at,
        IFNULL(mc.member_count, 0) AS member_count,
        IFNULL(rc.repo_count, 0) AS repo_count,
        IFNULL(ms.milestone_count, 0) AS milestone_count,
        IFNULL(wi.work_item_count, 0) AS work_item_count,
        IFNULL(ri.requirement_count, 0) AS requirement_count,
        (
          SELECT COUNT(*)
          FROM project_documents pd
          WHERE pd.project_id = p.id
             OR pd.milestone_id IN (SELECT id FROM milestones WHERE project_id = p.id)
             OR pd.work_item_id IN (SELECT id FROM work_items WHERE project_id = p.id)
        ) AS document_count,
        IFNULL(dl.deliverable_count, 0) AS deliverable_count,
        IFNULL(ap.approval_count, 0) AS approval_count
      FROM aims_projects p
      LEFT JOIN project_portfolios pf ON pf.id = p.portfolio_id
      LEFT JOIN project_template_sets ts ON ts.id = p.template_set_id
      LEFT JOIN project_template_versions tv ON tv.id = p.template_version_id
      LEFT JOIN (SELECT project_id, COUNT(*) AS member_count FROM aims_project_members GROUP BY project_id) mc ON mc.project_id = p.id
      LEFT JOIN (SELECT project_id, COUNT(*) AS repo_count FROM aims_project_repos GROUP BY project_id) rc ON rc.project_id = p.id
      LEFT JOIN (SELECT project_id, COUNT(*) AS milestone_count FROM milestones GROUP BY project_id) ms ON ms.project_id = p.id
      LEFT JOIN (SELECT project_id, COUNT(*) AS work_item_count FROM work_items GROUP BY project_id) wi ON wi.project_id = p.id
      LEFT JOIN (SELECT project_id, COUNT(*) AS requirement_count FROM requirement_items GROUP BY project_id) ri ON ri.project_id = p.id
      LEFT JOIN (SELECT project_id, COUNT(*) AS deliverable_count FROM deliverables GROUP BY project_id) dl ON dl.project_id = p.id
      LEFT JOIN (SELECT project_id, COUNT(*) AS approval_count FROM approval_records GROUP BY project_id) ap ON ap.project_id = p.id
      ${whereClause}
      ORDER BY p.updated_at DESC, p.id DESC
      LIMIT ? OFFSET ?
    `,
    [...params, pageSize, offset]
  )

  return {
    code: 0,
    data: {
      items: rows.map(row => ({
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
        portfolioName: row.portfolio_name,
        domainCode: row.domain_code,
        deptCode: row.dept_code,
        leaderUid: row.leader_uid,
        startDate: row.start_date,
        endDate: row.end_date,
        customerName: row.customer_name,
        contractCode: row.contract_code,
        templateSetName: row.template_set_name,
        templateVersionLabel: row.template_version_label,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        counts: {
          members: Number(row.member_count || 0),
          repos: Number(row.repo_count || 0),
          milestones: Number(row.milestone_count || 0),
          workItems: Number(row.work_item_count || 0),
          requirements: Number(row.requirement_count || 0),
          documents: Number(row.document_count || 0),
          deliverables: Number(row.deliverable_count || 0),
          approvals: Number(row.approval_count || 0)
        }
      })),
      total,
      page,
      pageSize
    }
  }
})
