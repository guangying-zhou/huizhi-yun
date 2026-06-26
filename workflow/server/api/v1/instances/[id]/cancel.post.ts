/**
 * POST /api/v1/instances/:id/cancel
 * 撤回流程（仅发起人在第一个节点未审批时可撤回）
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'
import { queryRow, queryRows, execute } from '~~/server/utils/db'
import { executeCallback } from '~~/server/utils/callbackService'
import { requirePermission } from '~~/server/utils/checkPermission'

interface InstanceRow extends RowDataPacket {
  id: number
  instance_no: string
  initiator_uid: string
  status: string
  current_node: number
  biz_title: string
  biz_id: string
  biz_url: string | null
  app_code: string
  resource_code: string
  action_code: string
  flow_snapshot: string
  callback_url: string | null
  form_data: string
}

interface TaskRow extends RowDataPacket {
  id: number
  assignee_uid: string
  status: string
}

interface ActionRow extends RowDataPacket {
  created_at: string
}

export default defineEventHandler(async (event) => {
  const currentUser = getRequestUid(event)
  if (!currentUser) {
    throw createError({ statusCode: 401, message: '未登录' })
  }
  await requirePermission(event, 'workflow_instances', 'cancel')

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

    // 仅发起人可撤回
    if (instance.initiator_uid !== currentUser) {
      throw createError({ statusCode: 403, message: '仅发起人可撤回' })
    }

    // 仅 running 状态可撤回
    if (instance.status !== 'running') {
      throw createError({ statusCode: 400, message: '当前状态不可撤回' })
    }

    // 检查流程配置是否允许撤回
    const flowSnapshot = typeof instance.flow_snapshot === 'string'
      ? JSON.parse(instance.flow_snapshot)
      : instance.flow_snapshot
    const config = flowSnapshot?.config || {}
    if (config.allow_withdraw === false) {
      throw createError({ statusCode: 400, message: '该流程不允许撤回' })
    }

    // 检查当前轮次是否有任务已完成（仅检查最近一次 resubmit 之后的任务）
    // 驳回后重新提交会产生 resubmit action，之前轮次的 completed 任务不应阻止撤回
    const lastResubmit = await queryRow<ActionRow>(
      `SELECT created_at FROM flow_actions
       WHERE instance_id = ? AND action = 'resubmit'
       ORDER BY created_at DESC LIMIT 1`,
      [id]
    )

    const completedTasksSql = lastResubmit
      ? 'SELECT id FROM flow_tasks WHERE instance_id = ? AND status = \'completed\' AND completed_at > ?'
      : 'SELECT id FROM flow_tasks WHERE instance_id = ? AND status = \'completed\''
    const completedTasksParams: unknown[] = lastResubmit
      ? [id, lastResubmit.created_at]
      : [id]
    const completedTasks = await queryRows<TaskRow[]>(completedTasksSql, completedTasksParams)

    if (completedTasks.length > 0) {
      throw createError({ statusCode: 400, message: '已有审批人操作，无法撤回' })
    }

    // 取消所有 pending 任务
    await execute<ResultSetHeader>(
      'UPDATE flow_tasks SET status = \'cancelled\', updated_at = NOW() WHERE instance_id = ? AND status = \'pending\'',
      [id]
    )

    // 更新实例状态
    await execute<ResultSetHeader>(
      'UPDATE flow_instances SET status = \'cancelled\', completed_at = NOW(), updated_at = NOW() WHERE id = ?',
      [id]
    )

    // 通知当前节点审批人
    const pendingTasks = await queryRows<TaskRow[]>(
      'SELECT DISTINCT assignee_uid FROM flow_tasks WHERE instance_id = ? AND node_index = ?',
      [id, instance.current_node]
    )

    if (pendingTasks.length > 0) {
      try {
        await sendNotification({
          touser: pendingTasks.map(t => t.assignee_uid),
          title: '审批已撤回',
          description: `${currentUser}已撤回「${instance.biz_title}」`,
          url: instance.biz_url || ''
        })
      } catch (e) {
        console.error('[Cancel] 发送通知失败:', e)
      }
    }

    // 触发回调
    if (instance.callback_url) {
      const formData = typeof instance.form_data === 'string' ? JSON.parse(instance.form_data) : instance.form_data
      try {
        await executeCallback(instance.callback_url, {
          event: 'flow_completed',
          instance_id: instance.id,
          instance_no: instance.instance_no,
          app_code: instance.app_code,
          resource_code: instance.resource_code,
          action_code: instance.action_code,
          biz_id: instance.biz_id,
          status: 'cancelled',
          form_data: formData,
          completed_at: new Date().toISOString(),
          initiator_uid: instance.initiator_uid
        })
      } catch (e) {
        console.error('[Cancel] 回调失败:', e)
      }
    }

    return {
      code: 0,
      data: {
        instance_id: instance.id,
        status: 'cancelled'
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('撤回流程失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '撤回流程失败'
    })
  }
})
