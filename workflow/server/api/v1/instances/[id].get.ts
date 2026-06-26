/**
 * GET /api/v1/instances/:id
 * 查询流程实例详情
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { queryRow, queryRows } from '~~/server/utils/db'
import { buildCapabilities, buildBusinessView } from '~~/server/utils/capabilities'

interface InstanceRow extends RowDataPacket {
  id: number
  instance_no: string
  action_def_id: number
  route_id: number
  flow_schema_id: number
  app_code: string
  resource_code: string
  action_code: string
  biz_id: string
  biz_title: string
  biz_url: string | null
  biz_context: string
  form_data: string
  attachments: string
  initiator_uid: string
  status: string
  current_node: number
  flow_snapshot: string
  callback_url: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

interface TaskRow extends RowDataPacket {
  id: number
  instance_id: number
  node_index: number
  node_name: string
  assignee_uid: string
  task_type: string
  status: string
  due_at: string | null
  completed_at: string | null
  created_at: string
}

interface ActionRow extends RowDataPacket {
  id: number
  instance_id: number
  task_id: number
  actor_uid: string
  action: string
  comment: string | null
  attachments: string | null
  created_at: string
}

interface ActionDefRow extends RowDataPacket {
  name: string
  embed_url_pattern: string | null
}

export default defineEventHandler(async (event) => {
  const currentUser = getRequestUid(event)
  if (!currentUser) {
    throw createError({ statusCode: 401, message: '未登录' })
  }

  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: '实例 ID 必填' })
  }

  try {
    const instance = await queryRow<InstanceRow>(
      'SELECT * FROM flow_instances WHERE id = ?',
      [id]
    )

    if (!instance) {
      throw createError({ statusCode: 404, message: '流程实例不存在' })
    }

    // 访问控制：发起人或任务相关人可查看
    const relatedTasks = await queryRows<TaskRow[]>(
      'SELECT id FROM flow_tasks WHERE instance_id = ? AND assignee_uid = ?',
      [id, currentUser]
    )
    if (instance.initiator_uid !== currentUser && relatedTasks.length === 0) {
      throw createError({ statusCode: 403, message: '无权查看此流程实例' })
    }

    const tasks = await queryRows<TaskRow[]>(
      'SELECT * FROM flow_tasks WHERE instance_id = ? ORDER BY node_index ASC, id ASC',
      [id]
    )

    const actions = await queryRows<ActionRow[]>(
      'SELECT * FROM flow_actions WHERE instance_id = ? ORDER BY created_at ASC',
      [id]
    )

    // 查找当前用户在此实例中的 pending 任务
    const myTask = await queryRow<TaskRow>(
      `SELECT * FROM flow_tasks
       WHERE instance_id = ? AND assignee_uid = ? AND status = 'pending'
       LIMIT 1`,
      [id, currentUser]
    )

    // 查询 action_def 获取展示名称和 embed_url_pattern
    const actionDef = await queryRow<ActionDefRow>(
      'SELECT name, embed_url_pattern FROM flow_action_defs WHERE id = ?',
      [instance.action_def_id]
    )

    const requestAppCode = (getQuery(event).request_app_code as string) || ''

    return {
      code: 0,
      data: {
        id: instance.id,
        instance_no: instance.instance_no,
        action_def_id: instance.action_def_id,
        app_code: instance.app_code,
        resource_code: instance.resource_code,
        action_code: instance.action_code,
        action_name: actionDef?.name || null,
        biz_id: instance.biz_id,
        biz_title: instance.biz_title,
        biz_url: instance.biz_url,
        biz_context: typeof instance.biz_context === 'string' ? JSON.parse(instance.biz_context) : instance.biz_context,
        form_data: typeof instance.form_data === 'string' ? JSON.parse(instance.form_data) : instance.form_data,
        attachments: typeof instance.attachments === 'string' ? JSON.parse(instance.attachments) : instance.attachments,
        initiator_uid: instance.initiator_uid,
        status: instance.status,
        current_node: instance.current_node,
        flow_snapshot: typeof instance.flow_snapshot === 'string' ? JSON.parse(instance.flow_snapshot) : instance.flow_snapshot,
        completed_at: instance.completed_at,
        created_at: instance.created_at,
        updated_at: instance.updated_at,
        tasks: tasks.map(t => ({
          id: t.id,
          node_index: t.node_index,
          node_name: t.node_name,
          assignee_uid: t.assignee_uid,
          task_type: t.task_type,
          status: t.status,
          due_at: t.due_at,
          completed_at: t.completed_at,
          created_at: t.created_at
        })),
        actions: actions.map(a => ({
          id: a.id,
          task_id: a.task_id,
          actor_uid: a.actor_uid,
          action: a.action,
          comment: a.comment,
          attachments: a.attachments ? (typeof a.attachments === 'string' ? JSON.parse(a.attachments) : a.attachments) : null,
          created_at: a.created_at
        })),
        capabilities: buildCapabilities(instance, myTask, currentUser),
        business_view: buildBusinessView(
          {
            app_code: instance.app_code,
            resource_code: instance.resource_code,
            biz_id: instance.biz_id,
            biz_url: instance.biz_url,
            biz_context: instance.biz_context
          },
          actionDef?.embed_url_pattern || null,
          requestAppCode
        )
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('查询流程实例失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '查询流程实例失败'
    })
  }
})
