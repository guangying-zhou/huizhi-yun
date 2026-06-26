/**
 * POST /api/v1/tasks/:id/reject
 * 驳回任务
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'
import { queryRow, execute } from '~~/server/utils/db'
import { createTasksForNode } from '~~/server/utils/flowEngine'
import { executeCallback } from '~~/server/utils/callbackService'
import { requirePermission } from '~~/server/utils/checkPermission'

interface TaskRow extends RowDataPacket {
  id: number
  instance_id: number
  node_index: number
  node_name: string
  assignee_uid: string
  status: string
}

interface InstanceRow extends RowDataPacket {
  id: number
  instance_no: string
  status: string
  current_node: number
  initiator_uid: string
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

export default defineEventHandler(async (event) => {
  const currentUser = getRequestUid(event)
  if (!currentUser) {
    throw createError({ statusCode: 401, message: '未登录' })
  }
  await requirePermission(event, 'workflow_tasks', 'reject')

  const taskId = getRouterParam(event, 'id')
  if (!taskId) {
    throw createError({ statusCode: 400, message: '任务 ID 必填' })
  }

  const body = await readBody(event)
  const { comment } = body

  if (!comment) {
    throw createError({ statusCode: 400, message: '驳回意见必填' })
  }

  try {
    const task = await queryRow<TaskRow>(
      'SELECT * FROM flow_tasks WHERE id = ?',
      [taskId]
    )

    if (!task) {
      throw createError({ statusCode: 404, message: '任务不存在' })
    }

    if (task.assignee_uid !== currentUser) {
      throw createError({ statusCode: 403, message: '无权操作此任务' })
    }

    if (task.status !== 'pending') {
      throw createError({ statusCode: 400, message: '任务已处理' })
    }

    const instance = await queryRow<InstanceRow>(
      'SELECT * FROM flow_instances WHERE id = ?',
      [task.instance_id]
    )

    if (!instance || instance.status !== 'running') {
      throw createError({ statusCode: 400, message: '流程已结束或不存在' })
    }

    const flowSnapshot = typeof instance.flow_snapshot === 'string'
      ? JSON.parse(instance.flow_snapshot)
      : instance.flow_snapshot

    const config = flowSnapshot.config || {}
    const rejectStrategy = config.reject_strategy || 'to_initiator'

    // 更新当前任务
    await execute<ResultSetHeader>(
      'UPDATE flow_tasks SET status = \'completed\', completed_at = NOW(), updated_at = NOW() WHERE id = ?',
      [taskId]
    )

    // 记录操作
    await execute<ResultSetHeader>(
      `INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, created_at)
       VALUES (?, ?, ?, 'reject', ?, NOW())`,
      [task.instance_id, taskId, currentUser, comment]
    )

    // 取消当前节点其他 pending 任务
    await execute<ResultSetHeader>(
      'UPDATE flow_tasks SET status = \'cancelled\', updated_at = NOW() WHERE instance_id = ? AND node_index = ? AND status = \'pending\' AND id != ?',
      [task.instance_id, task.node_index, taskId]
    )

    if (rejectStrategy === 'to_previous' && task.node_index > 0) {
      // 退回上一节点：重新创建上一节点的任务
      const prevNodeIndex = task.node_index - 1
      const prevNode = flowSnapshot.nodes[prevNodeIndex]

      await execute<ResultSetHeader>(
        'UPDATE flow_instances SET current_node = ?, updated_at = NOW() WHERE id = ?',
        [prevNodeIndex, task.instance_id]
      )

      await createTasksForNode(task.instance_id, prevNodeIndex, prevNode)

      // 通知上一节点审批人
      if (prevNode.resolved_assignees?.length) {
        try {
          await sendNotification({
            touser: prevNode.resolved_assignees.map((a: { uid: string }) => a.uid),
            title: '审批被退回',
            description: `「${instance.biz_title}」被退回至您重新审批，原因：${comment}`,
            url: instance.biz_url || ''
          })
        } catch (e) {
          console.error('[Reject] 发送通知失败:', e)
        }
      }
    } else {
      // 退回发起人
      await execute<ResultSetHeader>(
        'UPDATE flow_instances SET status = \'rejected\', completed_at = NOW(), updated_at = NOW() WHERE id = ?',
        [task.instance_id]
      )

      // 取消所有剩余 pending 任务
      await execute<ResultSetHeader>(
        'UPDATE flow_tasks SET status = \'cancelled\', updated_at = NOW() WHERE instance_id = ? AND status = \'pending\'',
        [task.instance_id]
      )

      // 通知发起人
      try {
        await sendNotification({
          touser: instance.initiator_uid,
          title: '审批被驳回',
          description: `您的「${instance.biz_title}」被${currentUser}驳回，原因：${comment}`,
          url: instance.biz_url || ''
        })
      } catch (e) {
        console.error('[Reject] 发送通知失败:', e)
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
            status: 'rejected',
            form_data: formData,
            completed_at: new Date().toISOString(),
            initiator_uid: instance.initiator_uid,
            approval_actor_uids: [currentUser],
            approval_operator_uid: currentUser,
            non_self_approval_actor_uids: currentUser === instance.initiator_uid ? [] : [currentUser],
            has_non_self_approval: currentUser !== instance.initiator_uid
          })
        } catch (e) {
          console.error('[Reject] 回调失败:', e)
        }
      }
    }

    return {
      code: 0,
      data: {
        task_id: parseInt(taskId),
        instance_id: task.instance_id,
        reject_strategy: rejectStrategy
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('驳回失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '驳回失败'
    })
  }
})
