/**
 * POST /api/v1/tasks/:id/delegate
 * 委托任务给其他用户
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'
import { queryRow, execute } from '~~/server/utils/db'
import { getDirectoryUserByUid } from '~~/server/utils/directoryRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'

interface TaskRow extends RowDataPacket {
  id: number
  instance_id: number
  node_index: number
  node_name: string
  assignee_uid: string
  task_type: string
  status: string
}

interface InstanceRow extends RowDataPacket {
  id: number
  status: string
  biz_title: string
  biz_url: string | null
  flow_snapshot: string
}

export default defineEventHandler(async (event) => {
  const currentUser = getRequestUid(event)
  if (!currentUser) {
    throw createError({ statusCode: 401, message: '未登录' })
  }
  await requirePermission(event, 'workflow_tasks', 'delegate')

  const taskId = getRouterParam(event, 'id')
  if (!taskId) {
    throw createError({ statusCode: 400, message: '任务 ID 必填' })
  }

  const body = await readBody(event)
  const { delegate_to, comment } = body

  if (!delegate_to) {
    throw createError({ statusCode: 400, message: '被委托人 UID 必填' })
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
      'SELECT id, status, biz_title, biz_url, flow_snapshot FROM flow_instances WHERE id = ?',
      [task.instance_id]
    )

    if (!instance || instance.status !== 'running') {
      throw createError({ statusCode: 400, message: '流程已结束或不存在' })
    }

    // 检查流程配置是否允许委托
    const flowSnapshot = typeof instance.flow_snapshot === 'string'
      ? JSON.parse(instance.flow_snapshot)
      : instance.flow_snapshot
    const config = flowSnapshot?.config || {}
    if (config.allow_delegate === false) {
      throw createError({ statusCode: 400, message: '该流程不允许委托' })
    }

    // 验证被委托人是否存在
    const delegateUser = await getDirectoryUserByUid(delegate_to)
    if (!delegateUser) {
      throw createError({ statusCode: 400, message: '被委托人不存在' })
    }

    // 更新任务的办理人
    await execute<ResultSetHeader>(
      'UPDATE flow_tasks SET assignee_uid = ?, updated_at = NOW() WHERE id = ?',
      [delegate_to, taskId]
    )

    // 记录委托操作
    await execute<ResultSetHeader>(
      `INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, created_at)
       VALUES (?, ?, ?, 'delegate', ?, NOW())`,
      [
        task.instance_id,
        taskId,
        currentUser,
        comment || `委托给${delegateUser.realName || delegateUser.displayName || delegate_to}`
      ]
    )

    // 通知被委托人
    try {
      await sendNotification({
        touser: delegate_to,
        title: '您收到一项委托审批',
        description: `${currentUser}将「${instance.biz_title}」的审批委托给您处理`,
        url: instance.biz_url || ''
      })
    } catch (e) {
      console.error('[Delegate] 发送通知失败:', e)
    }

    return {
      code: 0,
      data: {
        task_id: parseInt(taskId),
        delegate_to,
        delegate_name: delegateUser.realName || delegateUser.displayName || delegate_to
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('委托失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '委托失败'
    })
  }
})
