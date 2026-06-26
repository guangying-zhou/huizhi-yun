/**
 * GET /api/v1/instances/by-biz?app_code=X&resource_code=Y&biz_id=N&action_code=Z
 * 按完整 biz_key 查询流程实例
 *
 * 四个参数全部必填（biz_key = app_code + resource_code + biz_id + action_code）
 * 默认只返回活动实例（running/suspended），传 include_history=true 可返回最近历史实例
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { queryRow, queryRows } from '~~/server/utils/db'
import { buildCapabilities } from '~~/server/utils/capabilities'

interface InstanceRow extends RowDataPacket {
  id: number
  instance_no: string
  app_code: string
  resource_code: string
  action_code: string
  biz_id: string
  biz_title: string
  biz_url: string | null
  initiator_uid: string
  status: string
  current_node: number
  flow_snapshot: string
  created_at: string
  completed_at: string | null
}

interface TaskRow extends RowDataPacket {
  id: number
  assignee_uid: string
  status: string
}

interface ActionRow extends RowDataPacket {
  id: number
  task_id: number
  actor_uid: string
  action: string
  comment: string | null
  created_at: string
  node_index: number
  node_name: string
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const appCode = query.app_code as string
  const resourceCode = query.resource_code as string
  const bizId = query.biz_id as string
  const actionCode = query.action_code as string
  const includeHistory = query.include_history === 'true'

  if (!appCode || !resourceCode || !bizId || !actionCode) {
    throw createError({
      statusCode: 400,
      message: '缺少必填参数：app_code, resource_code, biz_id, action_code'
    })
  }

  try {
    const conditions = ['app_code = ?', 'resource_code = ?', 'biz_id = ?', 'action_code = ?']
    const params: unknown[] = [appCode, resourceCode, bizId, actionCode]

    if (!includeHistory) {
      conditions.push('status IN (\'running\', \'suspended\')')
    }

    const instance = await queryRow<InstanceRow>(
      `SELECT id, instance_no, app_code, resource_code, action_code,
              biz_id, biz_title, biz_url, initiator_uid,
              status, current_node, flow_snapshot, created_at, completed_at
       FROM flow_instances
       WHERE ${conditions.join(' AND ')}
       ORDER BY id DESC LIMIT 1`,
      params
    )

    if (!instance) {
      return { code: 0, data: null }
    }

    // 获取操作记录（timeline）
    const actions = await queryRows<ActionRow[]>(
      `SELECT a.id, a.task_id, a.actor_uid, a.action, a.comment, a.created_at,
              t.node_index, t.node_name
       FROM flow_actions a
       LEFT JOIN flow_tasks t ON a.task_id = t.id
       WHERE a.instance_id = ?
       ORDER BY a.created_at ASC`,
      [instance.id]
    )

    // 构建 capabilities
    let capabilities = null
    const currentUser = getRequestUid(event) || ''
    if (currentUser) {
      const myTask = await queryRow<TaskRow>(
        `SELECT id, assignee_uid, status FROM flow_tasks
         WHERE instance_id = ? AND assignee_uid = ? AND status = 'pending'
         LIMIT 1`,
        [instance.id, currentUser]
      )
      capabilities = buildCapabilities(instance, myTask, currentUser)
    }

    const flowSnapshot = typeof instance.flow_snapshot === 'string'
      ? JSON.parse(instance.flow_snapshot)
      : instance.flow_snapshot

    return {
      code: 0,
      data: {
        instance_id: instance.id,
        instance_no: instance.instance_no,
        app_code: instance.app_code,
        resource_code: instance.resource_code,
        action_code: instance.action_code,
        biz_id: instance.biz_id,
        biz_title: instance.biz_title,
        biz_url: instance.biz_url,
        initiator_uid: instance.initiator_uid,
        status: instance.status,
        current_node: instance.current_node,
        flow_snapshot: flowSnapshot,
        created_at: instance.created_at,
        completed_at: instance.completed_at,
        actions: actions.map(a => ({
          node_index: a.node_index,
          node_name: a.node_name,
          actor_uid: a.actor_uid,
          action: a.action,
          comment: a.comment,
          created_at: a.created_at
        })),
        capabilities
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('按业务查询实例失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '按业务查询实例失败'
    })
  }
})
