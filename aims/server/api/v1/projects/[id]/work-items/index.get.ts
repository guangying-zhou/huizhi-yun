/**
 * 获取项目工作项列表
 * GET /api/v1/projects/:id/work-items?type=&status=&milestoneId=&assigneeUid=&priority=&search=&page=&pageSize=&view=board
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { hasWorkItemStartDateColumn } from '~~/server/utils/workItemStartDate'

interface WorkItemRow extends RowDataPacket {
  id: number
  project_id: number
  milestone_id: number
  item_number: number
  item_key: string
  type: string
  title: string
  description: string | null
  start_date: string | null
  status: string
  priority: string
  severity: string | null
  weight: number
  assignee_uid: string | null
  reporter_uid: string | null
  due_date: string | null
  estimated_hours: number | null
  parent_id: number | null
  sort_order: number
  required: number
  template_key: string | null
  approval_status: string
  created_at: string
  updated_at: string
  assignee_name: string | null
  reporter_name: string | null
  milestone_name: string | null
  child_count: number
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const projectId = Number(getRouterParam(event, 'id'))
  if (!projectId || isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const query = getQuery(event)
  const supportsStartDate = await hasWorkItemStartDateColumn()
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))
  const offset = (page - 1) * pageSize
  const view = query.view as string | undefined

  const conditions: string[] = ['wi.project_id = ?']
  const params: unknown[] = [projectId]

  if (query.type) {
    conditions.push('wi.type = ?')
    params.push(query.type)
  }
  if (query.status) {
    conditions.push('wi.status = ?')
    params.push(query.status)
  }
  if (query.milestoneId) {
    conditions.push('wi.milestone_id = ?')
    params.push(Number(query.milestoneId))
  }
  if (query.assigneeUid) {
    conditions.push('wi.assignee_uid = ?')
    params.push(query.assigneeUid)
  }
  if (query.priority) {
    conditions.push('wi.priority = ?')
    params.push(query.priority)
  }
  if (query.search) {
    conditions.push('(wi.title LIKE ? OR wi.item_key LIKE ?)')
    const keyword = `%${query.search}%`
    params.push(keyword, keyword)
  }
  if (query.tier) {
    conditions.push('wi.tier = ?')
    params.push(query.tier)
  } else if (query.parentId !== undefined) {
    if (query.parentId === 'null' || query.parentId === '') {
      conditions.push('wi.parent_id IS NULL')
    } else {
      conditions.push('wi.parent_id = ?')
      params.push(Number(query.parentId))
    }
  } else {
    // 默认只返回顶层工作项（target 层）
    conditions.push('wi.tier = \'target\'')
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`

  // Board 视图：按状态分组返回
  if (view === 'board') {
    const sql = `
      SELECT wi.*,
             ${supportsStartDate ? 'wi.start_date' : 'NULL AS start_date'},
             ml.name AS milestone_name,
             IFNULL(cc.child_count, 0) AS child_count
      FROM work_items wi
      LEFT JOIN milestones ml ON ml.id = wi.milestone_id
      LEFT JOIN (
        SELECT parent_id, COUNT(*) AS child_count
        FROM work_items
        WHERE parent_id IS NOT NULL
        GROUP BY parent_id
      ) cc ON cc.parent_id = wi.id
      ${whereClause}
      ORDER BY wi.sort_order ASC, wi.created_at ASC
    `
    const rows = await queryRows<WorkItemRow[]>(sql, params)

    const items = rows.map(mapRow)
    const boardData: Record<string, ReturnType<typeof mapRow>[]> = {}

    for (const item of items) {
      const status = item.status
      if (!boardData[status]) {
        boardData[status] = []
      }
      boardData[status]!.push(item)
    }

    return { code: 0, data: boardData }
  }

  // 列表视图：分页
  const countSql = `SELECT COUNT(*) AS total FROM work_items wi ${whereClause}`
  const countRow = await queryRow<CountRow>(countSql, params)
  const total = countRow?.total || 0

  const listSql = `
    SELECT wi.*,
           ${supportsStartDate ? 'wi.start_date' : 'NULL AS start_date'},
           ml.name AS milestone_name,
           IFNULL(cc.child_count, 0) AS child_count
    FROM work_items wi
    LEFT JOIN milestones ml ON ml.id = wi.milestone_id
    LEFT JOIN (
      SELECT parent_id, COUNT(*) AS child_count
      FROM work_items
      WHERE parent_id IS NOT NULL
      GROUP BY parent_id
    ) cc ON cc.parent_id = wi.id
    ${whereClause}
    ORDER BY wi.sort_order ASC, wi.created_at DESC
    LIMIT ? OFFSET ?
  `
  const listParams = [...params, pageSize, offset]
  const rows = await queryRows<WorkItemRow[]>(listSql, listParams)

  return {
    code: 0,
    data: {
      items: rows.map(mapRow),
      total,
      page,
      pageSize
    }
  }
})

function mapRow(row: WorkItemRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    milestoneId: row.milestone_id,
    itemNumber: row.item_number,
    itemKey: row.item_key,
    type: row.type,
    title: row.title,
    description: row.description,
    startDate: row.start_date,
    status: row.status,
    priority: row.priority,
    severity: row.severity,
    weight: row.weight,
    assigneeUid: row.assignee_uid,
    reporterUid: row.reporter_uid,
    dueDate: row.due_date,
    estimatedHours: row.estimated_hours,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    required: Boolean(row.required),
    templateKey: row.template_key,
    approvalStatus: row.approval_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    milestoneName: row.milestone_name,
    childCount: row.child_count
  }
}
