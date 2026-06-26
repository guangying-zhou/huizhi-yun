/**
 * 个人看板数据
 * GET /api/v1/my-board?projectId=
 * 返回当前用户的工作项按状态分组，支持按项目筛选
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface ItemRow extends RowDataPacket {
  id: number
  project_id: number
  item_number: number
  item_key: string
  type: string
  title: string
  status: string
  priority: string
  severity: string | null
  assignee_uid: string | null
  reporter_uid: string | null
  due_date: string | null
  estimated_hours: number | null
  sort_order: number
  created_at: string
  updated_at: string
  project_name: string
  project_code: string
}

interface ProjectRow extends RowDataPacket {
  id: number
  name: string
  project_code: string
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const query = getQuery(event)
  const projectId = query.projectId ? Number(query.projectId) : null

  // 获取用户所在的所有项目
  const projects = await queryRows<ProjectRow[]>(
    `SELECT p.id, p.name, p.project_code
     FROM aims_projects p
     INNER JOIN aims_project_members m ON m.project_id = p.id
     WHERE m.uid = ? AND p.lifecycle_status IN ('active', 'approval_pending')
     ORDER BY p.name`,
    [uid]
  )

  // 查询工作项
  const conditions = ['wi.assignee_uid = ?']
  const params: unknown[] = [uid]

  if (projectId) {
    conditions.push('wi.project_id = ?')
    params.push(projectId)
  } else {
    // 只查用户所在项目的工作项
    const projectIds = projects.map(p => p.id)
    if (projectIds.length === 0) {
      return {
        code: 0,
        data: {
          projects: [],
          board: {},
          stats: { todo: 0, inProgress: 0, done: 0 }
        }
      }
    }
    conditions.push(`wi.project_id IN (${projectIds.map(() => '?').join(',')})`)
    params.push(...projectIds)
  }

  // 排除已完成超过 7 天的
  conditions.push('NOT (wi.status = \'completed\' AND wi.updated_at < DATE_SUB(NOW(), INTERVAL 7 DAY))')

  const sql = `
    SELECT wi.id, wi.project_id, wi.item_number, wi.item_key,
           wi.type, wi.title, wi.status, wi.priority, wi.severity,
           wi.assignee_uid, wi.reporter_uid, wi.due_date, wi.estimated_hours,
           wi.sort_order, wi.created_at, wi.updated_at,
           p.name AS project_name, p.project_code
    FROM work_items wi
    INNER JOIN aims_projects p ON p.id = wi.project_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY FIELD(wi.priority, 'P0', 'P1', 'P2', 'P3'), wi.sort_order ASC, wi.created_at ASC
  `
  const rows = await queryRows<ItemRow[]>(sql, params)

  // 按状态分组
  const board: Record<string, ReturnType<typeof mapRow>[]> = {}
  const items = rows.map(mapRow)

  for (const item of items) {
    if (!board[item.status]) {
      board[item.status] = []
    }
    board[item.status]!.push(item)
  }

  // 统计
  const stats = {
    todo: (board.planning?.length || 0) + (board.todo?.length || 0),
    inProgress: (board.in_progress?.length || 0) + (board.in_review?.length || 0),
    done: (board.completed?.length || 0)
  }

  return {
    code: 0,
    data: {
      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        projectCode: p.project_code
      })),
      board,
      stats
    }
  }
})

function mapRow(row: ItemRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    itemNumber: row.item_number,
    itemKey: row.item_key,
    type: row.type,
    title: row.title,
    status: row.status,
    priority: row.priority,
    severity: row.severity,
    assigneeUid: row.assignee_uid,
    reporterUid: row.reporter_uid,
    dueDate: row.due_date,
    estimatedHours: row.estimated_hours,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    projectName: row.project_name,
    projectCode: row.project_code
  }
}
