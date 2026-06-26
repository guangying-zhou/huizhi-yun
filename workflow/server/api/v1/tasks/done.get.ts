/**
 * GET /api/v1/tasks/done?page=1&page_size=20
 * 我的已办任务
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { queryRows, queryRow } from '~~/server/utils/db'

interface TaskWithInstanceRow extends RowDataPacket {
  task_id: number
  instance_id: number
  instance_no: string
  resource_code: string
  action_code: string
  biz_title: string
  biz_url: string | null
  initiator_uid: string
  instance_status: string
  node_name: string
  task_type: string
  task_completed_at: string | null
  task_created_at: string
  action_name: string | null
}

interface CountRow extends RowDataPacket {
  total: number
}

export default defineEventHandler(async (event) => {
  const currentUser = getRequestUid(event)
  if (!currentUser) {
    throw createError({ statusCode: 401, message: '未登录' })
  }

  const query = getQuery(event)
  const page = parseInt(query.page as string) || 1
  const pageSize = parseInt(query.page_size as string) || 20
  const appCode = (query.app_code as string) || ''
  const offset = (page - 1) * pageSize

  try {
    const conditions = ['t.assignee_uid = ?', 't.status = \'completed\'']
    const params: unknown[] = [currentUser]

    if (appCode) {
      conditions.push('i.app_code = ?')
      params.push(appCode)
    }

    const whereClause = conditions.join(' AND ')

    const countRow = await queryRow<CountRow>(
      `SELECT COUNT(*) as total
       FROM flow_tasks t
       INNER JOIN flow_instances i ON t.instance_id = i.id
       WHERE ${whereClause}`,
      params
    )
    const total = countRow?.total || 0

    const rows = await queryRows<TaskWithInstanceRow[]>(
      `SELECT t.id as task_id, t.instance_id, i.instance_no,
              i.app_code, i.resource_code, i.action_code, i.biz_title, i.biz_url,
              i.initiator_uid, i.status as instance_status,
              t.node_name, t.task_type,
              t.completed_at as task_completed_at,
              t.created_at as task_created_at,
              a.name as action_name
       FROM flow_tasks t
       INNER JOIN flow_instances i ON t.instance_id = i.id
       LEFT JOIN flow_action_defs a ON i.action_def_id = a.id
       WHERE ${whereClause}
       ORDER BY t.completed_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    )

    return {
      code: 0,
      data: {
        total,
        items: rows.map(r => ({
          task_id: r.task_id,
          instance_id: r.instance_id,
          instance_no: r.instance_no,
          app_code: r.app_code,
          resource_code: r.resource_code,
          action_code: r.action_code,
          action_name: r.action_name,
          biz_title: r.biz_title,
          biz_url: r.biz_url,
          initiator_uid: r.initiator_uid,
          instance_status: r.instance_status,
          node_name: r.node_name,
          task_type: r.task_type,
          completed_at: r.task_completed_at,
          created_at: r.task_created_at
        }))
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('查询已办任务失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '查询已办任务失败'
    })
  }
})
