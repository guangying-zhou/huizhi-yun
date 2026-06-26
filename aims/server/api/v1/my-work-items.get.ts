/**
 * 全局工作项查询（按过滤条件）
 * GET /api/v1/my-work-items?filter=assigned|member|created|verify|archived&uid=
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface ItemRow extends RowDataPacket {
  id: number
  project_id: number
  project_code: string
  milestone_id: number
  item_key: string
  tier: string
  type: string
  template_key: string | null
  title: string
  status: string
  priority: string
  severity: string | null
  weight: number
  assignee_uid: string | null
  reporter_uid: string | null
  parent_id: number | null
  due_date: string | null
  created_at: string
  updated_at: string
  project_name: string
  milestone_name: string | null
}

export default defineEventHandler(async (event) => {
  const authUid = getRequestUid(event)
  if (!authUid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const query = getQuery(event)
  const filter = (query.filter as string) || 'assigned'
  const uid = (query.uid as string) || authUid
  const projectId = query.projectId ? Number(query.projectId) : null
  const tier = query.tier ? String(query.tier) : null
  const search = query.search ? String(query.search).trim() : ''

  const baseSelect = `
    SELECT wi.id, wi.project_id, p.project_code, wi.milestone_id, wi.item_key, wi.tier, wi.type, wi.template_key, wi.title, wi.status,
           wi.priority, wi.severity, wi.weight, wi.assignee_uid, wi.reporter_uid,
           wi.parent_id, wi.due_date, wi.created_at, wi.updated_at, p.name AS project_name,
           ml.name AS milestone_name
    FROM work_items wi
    JOIN aims_projects p ON p.id = wi.project_id
    LEFT JOIN milestones ml ON ml.id = wi.milestone_id
  `
  let fromSql = ''
  const conditions: string[] = []
  let orderBySql = ''
  let limitSql = ''
  const params: unknown[] = []

  switch (filter) {
    case 'assigned':
      fromSql = baseSelect
      conditions.push('wi.assignee_uid = ?', 'wi.status != \'completed\'')
      orderBySql = 'ORDER BY FIELD(wi.priority, \'P0\', \'P1\', \'P2\', \'P3\'), wi.created_at DESC'
      params.push(uid)
      break

    case 'member':
      fromSql = `
        ${baseSelect}
        JOIN aims_project_members m ON m.project_id = wi.project_id AND m.uid = ?
      `
      conditions.push('wi.status != \'completed\'')
      orderBySql = 'ORDER BY wi.updated_at DESC'
      params.push(uid)
      break

    case 'created':
      fromSql = baseSelect
      conditions.push('wi.reporter_uid = ?')
      orderBySql = 'ORDER BY wi.created_at DESC'
      params.push(uid)
      break

    case 'verify':
      fromSql = baseSelect
      conditions.push('wi.reporter_uid = ?', 'wi.status = \'in_review\'')
      orderBySql = 'ORDER BY wi.updated_at DESC'
      params.push(uid)
      break

    case 'archived':
      fromSql = baseSelect
      conditions.push('(wi.assignee_uid = ? OR wi.reporter_uid = ?)', 'wi.status = \'completed\'')
      orderBySql = 'ORDER BY wi.updated_at DESC'
      limitSql = 'LIMIT 100'
      params.push(uid, uid)
      break

    default:
      throw createError({ statusCode: 400, message: '无效的过滤器' })
  }

  if (projectId && !Number.isNaN(projectId)) {
    conditions.push('wi.project_id = ?')
    params.push(projectId)
  }
  if (tier) {
    conditions.push('wi.tier = ?')
    params.push(tier)
  }
  if (search) {
    conditions.push('(wi.title LIKE ? OR wi.item_key LIKE ? OR p.name LIKE ?)')
    const keyword = `%${search}%`
    params.push(keyword, keyword, keyword)
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const sql = [fromSql, whereSql, orderBySql, limitSql].filter(Boolean).join('\n')

  const rows = await queryRows<ItemRow[]>(sql, params)

  return {
    code: 0,
    data: {
      items: rows.map(r => ({
        id: r.id,
        projectId: r.project_id,
        projectCode: r.project_code,
        milestoneId: r.milestone_id,
        itemKey: r.item_key,
        tier: r.tier,
        type: r.type,
        templateKey: r.template_key,
        title: r.title,
        status: r.status,
        priority: r.priority,
        severity: r.severity,
        weight: r.weight,
        assigneeUid: r.assignee_uid,
        reporterUid: r.reporter_uid,
        parentId: r.parent_id,
        dueDate: r.due_date,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        projectName: r.project_name,
        milestoneName: r.milestone_name
      })),
      total: rows.length
    }
  }
})
