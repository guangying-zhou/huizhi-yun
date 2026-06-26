/**
 * GET /api/v1/tasks/initiated?page=1&page_size=20
 * 我发起的流程
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { queryRows, queryRow } from '~~/server/utils/db'

interface InstanceRow extends RowDataPacket {
  id: number
  instance_no: string
  resource_code: string
  action_code: string
  biz_title: string
  biz_url: string | null
  status: string
  current_node: number
  created_at: string
  completed_at: string | null
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
  const status = query.status as string
  const appCode = (query.app_code as string) || ''
  const offset = (page - 1) * pageSize

  try {
    const conditions = ['i.initiator_uid = ?']
    const params: unknown[] = [currentUser]

    if (status) {
      conditions.push('i.status = ?')
      params.push(status)
    }

    if (appCode) {
      conditions.push('i.app_code = ?')
      params.push(appCode)
    }

    const whereClause = conditions.join(' AND ')

    const countRow = await queryRow<CountRow>(
      `SELECT COUNT(*) as total
       FROM flow_instances i
       WHERE ${whereClause}`,
      params
    )
    const total = countRow?.total || 0

    const rows = await queryRows<InstanceRow[]>(
      `SELECT i.id, i.instance_no, i.app_code, i.resource_code, i.action_code,
              i.biz_title, i.biz_url, i.status, i.current_node,
              i.created_at, i.completed_at,
              a.name as action_name
       FROM flow_instances i
       LEFT JOIN flow_action_defs a ON i.action_def_id = a.id
       WHERE ${whereClause}
       ORDER BY i.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    )

    return {
      code: 0,
      data: {
        total,
        items: rows.map(r => ({
          instance_id: r.id,
          instance_no: r.instance_no,
          app_code: r.app_code,
          resource_code: r.resource_code,
          action_code: r.action_code,
          action_name: r.action_name,
          biz_title: r.biz_title,
          biz_url: r.biz_url,
          status: r.status,
          current_node: r.current_node,
          created_at: r.created_at,
          completed_at: r.completed_at
        }))
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('查询我发起的流程失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '查询我发起的流程失败'
    })
  }
})
