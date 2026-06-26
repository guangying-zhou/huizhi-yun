/**
 * POST /api/v1/tasks/:id/approve
 * 审批通过
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'
import { queryRow, execute } from '~~/server/utils/db'
import { advanceFlow } from '~~/server/utils/flowEngine'
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
  flow_snapshot: string
}

export default defineEventHandler(async (event) => {
  const currentUser = getRequestUid(event)
  if (!currentUser) {
    throw createError({ statusCode: 401, message: '未登录' })
  }
  await requirePermission(event, 'workflow_tasks', 'approve')

  const taskId = getRouterParam(event, 'id')
  if (!taskId) {
    throw createError({ statusCode: 400, message: '任务 ID 必填' })
  }

  const body = await readBody(event)
  const { comment, attachments } = body

  try {
    // 1. 查询任务
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

    // 2. 检查实例状态
    const instance = await queryRow<InstanceRow>(
      'SELECT id, status, flow_snapshot FROM flow_instances WHERE id = ?',
      [task.instance_id]
    )

    if (!instance || instance.status !== 'running') {
      throw createError({ statusCode: 400, message: '流程已结束或不存在' })
    }

    // 3. 更新任务状态
    await execute<ResultSetHeader>(
      'UPDATE flow_tasks SET status = \'completed\', completed_at = NOW(), updated_at = NOW() WHERE id = ?',
      [taskId]
    )

    // 4. 记录操作
    await execute<ResultSetHeader>(
      `INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, attachments, created_at)
       VALUES (?, ?, ?, 'approve', ?, ?, NOW())`,
      [
        task.instance_id,
        taskId,
        currentUser,
        comment || null,
        attachments ? JSON.stringify(attachments) : null
      ]
    )

    // 5. 推进流程
    await advanceFlow(task.instance_id)

    // 6. 获取更新后的实例状态
    const updatedInstance = await queryRow<RowDataPacket>(
      'SELECT status, current_node, flow_snapshot FROM flow_instances WHERE id = ?',
      [task.instance_id]
    )

    const flowSnapshot = typeof updatedInstance?.flow_snapshot === 'string'
      ? JSON.parse(updatedInstance.flow_snapshot)
      : updatedInstance?.flow_snapshot

    const nextNodeIndex = updatedInstance?.current_node
    let nextNode = null
    if (updatedInstance?.status === 'running' && flowSnapshot?.nodes?.[nextNodeIndex]) {
      const n = flowSnapshot.nodes[nextNodeIndex]
      nextNode = {
        name: n.name,
        assignees: (n.resolved_assignees || []).map((a: { uid: string, name: string }) => ({
          uid: a.uid,
          name: a.name
        }))
      }
    }

    return {
      code: 0,
      data: {
        task_id: parseInt(taskId),
        instance_id: task.instance_id,
        instance_status: updatedInstance?.status || 'running',
        next_node: nextNode
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('审批通过失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '审批通过失败'
    })
  }
})
