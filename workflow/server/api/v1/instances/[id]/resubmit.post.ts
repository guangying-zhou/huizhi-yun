/**
 * POST /api/v1/instances/:id/resubmit
 * 驳回后重新提交
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'
import { queryRow, execute } from '~~/server/utils/db'
import { resolveAssignees, evaluateSkipWhen, createTasksForNode, collectInitiatorContext, maybeAutoApproveInitiatorNode } from '~~/server/utils/flowEngine'
import { requirePermission } from '~~/server/utils/checkPermission'

interface InstanceRow extends RowDataPacket {
  id: number
  instance_no: string
  initiator_uid: string
  status: string
  biz_title: string
  biz_id: string
  biz_url: string | null
  biz_context: string
  flow_snapshot: string
  form_data: string
}

export default defineEventHandler(async (event) => {
  const currentUser = getRequestUid(event)
  if (!currentUser) {
    throw createError({ statusCode: 401, message: '未登录' })
  }
  await requirePermission(event, 'workflow_instances', 'resubmit')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '实例 ID 必填' })
  }

  const body = await readBody(event)
  const { form_data, attachments, comment } = body

  try {
    const instance = await queryRow<InstanceRow>(
      'SELECT * FROM flow_instances WHERE id = ?',
      [id]
    )

    if (!instance) {
      throw createError({ statusCode: 404, message: '流程实例不存在' })
    }

    if (instance.initiator_uid !== currentUser) {
      throw createError({ statusCode: 403, message: '仅发起人可重新提交' })
    }

    if (instance.status !== 'rejected') {
      throw createError({ statusCode: 400, message: '仅驳回状态可重新提交' })
    }

    const flowSnapshot = typeof instance.flow_snapshot === 'string'
      ? JSON.parse(instance.flow_snapshot)
      : instance.flow_snapshot

    // 检查流程配置是否允许重新提交
    const config = flowSnapshot.config || {}
    if (config.allow_resubmit === false) {
      throw createError({ statusCode: 400, message: '该流程不允许重新提交' })
    }

    const bizContext = typeof instance.biz_context === 'string'
      ? JSON.parse(instance.biz_context)
      : instance.biz_context

    // 重新收集上下文
    const initiatorContext = await collectInitiatorContext(currentUser)
    const fullContext = {
      ...initiatorContext,
      ...bizContext,
      biz_id: instance.biz_id,
      instance_no: instance.instance_no,
      initiator_uid: currentUser,
      initiator_dept_code: initiatorContext.dept_code as string | undefined,
      form_data: form_data || (typeof instance.form_data === 'string' ? JSON.parse(instance.form_data) : instance.form_data)
    }

    // 重新解析审批人
    const nodes = flowSnapshot.nodes
    for (const node of nodes) {
      if (evaluateSkipWhen(node.skip_when, fullContext)) {
        node.resolved_assignees = []
        continue
      }
      node.resolved_assignees = await resolveAssignees(node.assignees, fullContext)
      if ((node.type === 'approve' || node.type === 'countersign') && node.resolved_assignees.length === 0) {
        throw createError({
          statusCode: 400,
          message: `节点"${node.name}"未解析到审批人`
        })
      }
    }

    // 找到第一个非跳过节点
    let firstNodeIndex = 0
    while (firstNodeIndex < nodes.length) {
      if (evaluateSkipWhen(nodes[firstNodeIndex].skip_when, fullContext)) {
        firstNodeIndex++
        continue
      }
      break
    }

    // 更新实例
    await execute<ResultSetHeader>(
      `UPDATE flow_instances
       SET status = 'running',
           current_node = ?,
           form_data = ?,
           attachments = COALESCE(?, attachments),
           flow_snapshot = ?,
           completed_at = NULL,
           updated_at = NOW()
       WHERE id = ?`,
      [
        firstNodeIndex,
        JSON.stringify(form_data || fullContext.form_data),
        attachments ? JSON.stringify(attachments) : null,
        JSON.stringify(flowSnapshot),
        id
      ]
    )

    // 清理旧的 pending 任务（防止重复）
    await execute<ResultSetHeader>(
      'UPDATE flow_tasks SET status = \'cancelled\', updated_at = NOW() WHERE instance_id = ? AND status = \'pending\'',
      [id]
    )

    // 记录操作（实例级操作，task_id 为 NULL）
    await execute<ResultSetHeader>(
      `INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, created_at)
       VALUES (?, NULL, ?, 'resubmit', ?, NOW())`,
      [id, currentUser, comment || null]
    )

    // 创建第一批任务
    if (firstNodeIndex < nodes.length) {
      const firstNode = nodes[firstNodeIndex]
      await createTasksForNode(parseInt(id), firstNodeIndex, firstNode)

      // 首节点若是"发起人自审批"，自动通过并推进
      const autoApproved = await maybeAutoApproveInitiatorNode(
        parseInt(id),
        firstNodeIndex,
        firstNode,
        instance.initiator_uid
      )

      if (!autoApproved) {
        const firstAssignees = firstNode.resolved_assignees
        if (firstAssignees?.length) {
          try {
            await sendNotification({
              touser: firstAssignees.map((a: { uid: string }) => a.uid),
              title: '审批重新提交',
              description: `${currentUser}重新提交了「${instance.biz_title}」，请审批`,
              url: instance.biz_url || ''
            })
          } catch (e) {
            console.error('[Resubmit] 发送通知失败:', e)
          }
        }
      }
    }

    return {
      code: 0,
      data: {
        instance_id: instance.id,
        status: 'running',
        current_node: firstNodeIndex
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('重新提交失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '重新提交失败'
    })
  }
})
