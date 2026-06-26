/**
 * GET /api/v1/instances/by-biz-history?app_code=X&resource_code=Y&biz_id=N
 * 按 biz_key 查询所有历史流程实例（不限 action_code）
 *
 * 返回该业务实体的所有审批记录，按创建时间倒序排列
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { queryRows } from '~~/server/utils/db'

interface InstanceRow extends RowDataPacket {
  id: number
  instance_no: string
  action_code: string
  action_name: string | null
  biz_title: string
  initiator_uid: string
  status: string
  created_at: string
  completed_at: string | null
}

interface ActionRow extends RowDataPacket {
  instance_id: number
  actor_uid: string
  action: string
  comment: string | null
  created_at: string
  node_name: string
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const appCode = query.app_code as string
  const resourceCode = query.resource_code as string
  const bizId = query.biz_id as string

  if (!appCode || !resourceCode || !bizId) {
    throw createError({
      statusCode: 400,
      message: '缺少必填参数：app_code, resource_code, biz_id'
    })
  }

  try {
    // 查询所有实例（倒序）
    const instances = await queryRows<InstanceRow[]>(
      `SELECT i.id, i.instance_no, i.action_code,
              d.name AS action_name,
              i.biz_title, i.initiator_uid, i.status,
              i.created_at, i.completed_at
       FROM flow_instances i
       LEFT JOIN flow_action_defs d
         ON d.app_code = i.app_code
         AND d.resource_code = i.resource_code
         AND d.action_code = i.action_code
       WHERE i.app_code = ? AND i.resource_code = ? AND i.biz_id = ?
       ORDER BY i.created_at DESC`,
      [appCode, resourceCode, bizId]
    )

    if (instances.length === 0) {
      return { code: 0, data: [] }
    }

    // 批量查询所有实例的操作记录
    const instanceIds = instances.map(i => i.id)
    const actions = await queryRows<ActionRow[]>(
      `SELECT a.instance_id, a.actor_uid, a.action, a.comment, a.created_at,
              COALESCE(t.node_name, '') AS node_name
       FROM flow_actions a
       LEFT JOIN flow_tasks t ON a.task_id = t.id
       WHERE a.instance_id IN (${instanceIds.map(() => '?').join(',')})
       ORDER BY a.created_at ASC`,
      instanceIds
    )

    // 按 instance_id 分组
    const actionMap = new Map<number, ActionRow[]>()
    for (const a of actions) {
      const list = actionMap.get(a.instance_id) || []
      list.push(a)
      actionMap.set(a.instance_id, list)
    }

    return {
      code: 0,
      data: instances.map(inst => ({
        instance_id: inst.id,
        instance_no: inst.instance_no,
        action_code: inst.action_code,
        action_name: inst.action_name,
        biz_title: inst.biz_title,
        initiator_uid: inst.initiator_uid,
        status: inst.status,
        created_at: inst.created_at,
        completed_at: inst.completed_at,
        actions: (actionMap.get(inst.id) || []).map(a => ({
          actor_uid: a.actor_uid,
          action: a.action,
          comment: a.comment,
          node_name: a.node_name,
          created_at: a.created_at
        }))
      }))
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('查询业务审批历史失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '查询业务审批历史失败'
    })
  }
})
