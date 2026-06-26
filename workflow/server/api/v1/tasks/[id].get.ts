/**
 * GET /api/v1/tasks/:id
 * 查询任务详情（包含关联的流程实例信息）
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { queryRow, queryRows } from '~~/server/utils/db'
import { buildCapabilities, buildBusinessView } from '~~/server/utils/capabilities'

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

interface InstanceRow extends RowDataPacket {
  id: number
  instance_no: string
  action_def_id: number
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

  const taskId = getRouterParam(event, 'id')
  if (!taskId) {
    throw createError({ statusCode: 400, message: '任务 ID 必填' })
  }

  try {
    // 1. 查询任务
    const task = await queryRow<TaskRow>(
      'SELECT * FROM flow_tasks WHERE id = ?',
      [taskId]
    )

    if (!task) {
      throw createError({ statusCode: 404, message: '任务不存在' })
    }

    // 访问控制：任务办理人或流程发起人可查看
    const instanceForAuth = await queryRow<InstanceRow>(
      'SELECT initiator_uid FROM flow_instances WHERE id = ?',
      [task.instance_id]
    )
    if (task.assignee_uid !== currentUser && instanceForAuth?.initiator_uid !== currentUser) {
      throw createError({ statusCode: 403, message: '无权查看此任务' })
    }

    // 2. 查询关联的流程实例
    const instance = await queryRow<InstanceRow>(
      'SELECT * FROM flow_instances WHERE id = ?',
      [task.instance_id]
    )

    if (!instance) {
      throw createError({ statusCode: 404, message: '关联的流程实例不存在' })
    }

    // 3. 查询动作定义（含 embed_url_pattern）
    const actionDef = await queryRow<ActionDefRow>(
      'SELECT name, embed_url_pattern FROM flow_action_defs WHERE id = ?',
      [instance.action_def_id]
    )

    // 4. 查询该实例的所有任务
    const tasks = await queryRows<TaskRow[]>(
      'SELECT * FROM flow_tasks WHERE instance_id = ? ORDER BY node_index ASC, id ASC',
      [task.instance_id]
    )

    // 5. 查询该实例的所有操作记录
    const actions = await queryRows<ActionRow[]>(
      'SELECT * FROM flow_actions WHERE instance_id = ? ORDER BY created_at ASC',
      [task.instance_id]
    )

    // 6. 构建 capabilities 和 business_view
    const requestAppCode = (getQuery(event).request_app_code as string) || ''

    return {
      code: 0,
      data: {
        task: {
          id: task.id,
          instance_id: task.instance_id,
          node_index: task.node_index,
          node_name: task.node_name,
          assignee_uid: task.assignee_uid,
          task_type: task.task_type,
          status: task.status,
          due_at: task.due_at,
          completed_at: task.completed_at,
          created_at: task.created_at
        },
        instance: {
          id: instance.id,
          instance_no: instance.instance_no,
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
          created_at: instance.created_at
        },
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
        capabilities: buildCapabilities(instance, task, currentUser),
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
    console.error('查询任务详情失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '查询任务详情失败'
    })
  }
})
