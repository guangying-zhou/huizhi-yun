/**
 * POST /api/v1/instances
 * 正式发起流程
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'
import { queryRow, execute } from '~~/server/utils/db'
import { resolveAssignees, evaluateSkipWhen, generateInstanceNo, createTasksForNode, collectInitiatorContext, maybeAutoApproveInitiatorNode } from '~~/server/utils/flowEngine'
import { maybeCallWorkflowDataRuntime, sendWorkflowRuntimeNotifications } from '~~/server/utils/dataRuntime'

interface FlowSchemaRow extends RowDataPacket {
  id: number
  code: string
  name: string
  nodes: string
  config: string
  version: number
}

interface ActionDefRow extends RowDataPacket {
  id: number
  app_code: string
  resource_code: string
  action_code: string
  name: string
}

interface RouteRow extends RowDataPacket {
  id: number
  flow_schema_id: number
}

interface ExistingInstanceRow extends RowDataPacket {
  id: number
  instance_no: string
  status: string
  initiator_uid: string
}

interface RuntimeNotification {
  touser?: string[]
  title?: string
  description?: string
  url?: string
}

interface WorkflowCreateRuntimeResponse {
  code: number
  data: {
    instance_id: number
    instance_no: string
    status: string
    current_node: number
    mode: 'created' | 'resubmitted'
    flow_snapshot: Record<string, unknown>
  }
  effects?: {
    notifications?: RuntimeNotification[]
  }
}

export default defineEventHandler(async (event) => {
  const currentUser = getRequestUid(event)
  if (!currentUser) {
    throw createError({ statusCode: 401, message: '未登录' })
  }

  const body = await readBody(event)
  const {
    action_def_id,
    route_id,
    biz_id,
    biz_title,
    biz_url,
    biz_context,
    form_data,
    attachments,
    callback_url
  } = body

  if (!action_def_id || !route_id || !biz_id || !biz_title) {
    throw createError({
      statusCode: 400,
      message: 'action_def_id, route_id, biz_id, biz_title 必填'
    })
  }

  const initiatorContext = await collectInitiatorContext(currentUser)
  const runtime = await maybeCallWorkflowDataRuntime<WorkflowCreateRuntimeResponse>(event, '/v1/workflow/instances', {
    scope: 'workflow.write',
    method: 'POST',
    body: {
      ...body,
      current_user: currentUser,
      initiator_context: initiatorContext
    }
  })
  if (runtime.handled) {
    await sendWorkflowRuntimeNotifications(event, runtime.data.effects?.notifications)
    return {
      code: runtime.data.code,
      data: runtime.data.data
    }
  }

  try {
    // 1. 验证动作定义
    const actionDef = await queryRow<ActionDefRow>(
      'SELECT * FROM flow_action_defs WHERE id = ? AND status = 1',
      [action_def_id]
    )
    if (!actionDef) {
      throw createError({ statusCode: 404, message: '动作定义不存在' })
    }

    // 1.5 biz_key 并发检查：同一 biz_key 最多一个活动实例
    const existingActive = await queryRow<RowDataPacket>(
      `SELECT id, instance_no, status FROM flow_instances
       WHERE app_code = ? AND resource_code = ? AND biz_id = ? AND action_code = ?
         AND status IN ('running', 'suspended')
       LIMIT 1`,
      [actionDef.app_code, actionDef.resource_code, biz_id, actionDef.action_code]
    )
    if (existingActive) {
      throw createError({
        statusCode: 409,
        message: `该业务已有进行中的审批流程（${existingActive.instance_no}）`
      })
    }

    // 查找可复用的历史实例（驳回或撤回）
    const existingRejected = await queryRow<ExistingInstanceRow>(
      `SELECT id, instance_no, status, initiator_uid
       FROM flow_instances
       WHERE app_code = ? AND resource_code = ? AND biz_id = ? AND action_code = ?
         AND status IN ('rejected', 'cancelled')
       ORDER BY id DESC
       LIMIT 1`,
      [actionDef.app_code, actionDef.resource_code, biz_id, actionDef.action_code]
    )

    // 2. 验证路由（必须属于当前动作定义）
    const route = await queryRow<RouteRow>(
      'SELECT * FROM flow_routes WHERE id = ? AND action_def_id = ? AND status = 1',
      [route_id, action_def_id]
    )
    if (!route) {
      throw createError({ statusCode: 404, message: '路由规则不存在或不属于该动作定义' })
    }

    // 3. 获取流程定义
    const flowSchema = await queryRow<FlowSchemaRow>(
      'SELECT * FROM flow_schemas WHERE id = ? AND status = 1',
      [route.flow_schema_id]
    )
    if (!flowSchema) {
      throw createError({ statusCode: 404, message: '流程定义不存在' })
    }

    const nodes = typeof flowSchema.nodes === 'string'
      ? JSON.parse(flowSchema.nodes)
      : flowSchema.nodes

    const config = typeof flowSchema.config === 'string'
      ? JSON.parse(flowSchema.config)
      : flowSchema.config

    let instanceId = 0
    let instanceNo = existingRejected?.instance_no || ''
    let submitMode: 'created' | 'resubmitted' = 'created'

    if (!instanceNo) {
      instanceNo = await generateInstanceNo()
    }

    // 4. 收集上下文
    const fullContext = {
      ...initiatorContext,
      ...(biz_context || {}),
      biz_id,
      instance_no: instanceNo,
      initiator_uid: currentUser,
      initiator_dept_code: initiatorContext.dept_code as string | undefined,
      resource_dept_code: biz_context?.resource_dept_code as string | undefined,
      form_data: form_data || {}
    }

    // 5. 解析每个节点的审批人并构建快照
    const snapshotNodes = []
    for (const node of nodes) {
      if (evaluateSkipWhen(node.skip_when, fullContext)) {
        snapshotNodes.push({
          ...node,
          resolved_assignees: []
        })
        continue
      }

      const resolvedAssignees = await resolveAssignees(node.assignees, fullContext)
      if ((node.type === 'approve' || node.type === 'countersign') && resolvedAssignees.length === 0) {
        throw createError({
          statusCode: 400,
          message: `节点"${node.name}"未解析到审批人`
        })
      }
      snapshotNodes.push({
        ...node,
        resolved_assignees: resolvedAssignees
      })
    }

    const flowSnapshot = { nodes: snapshotNodes, config }

    // 6. 找到第一个非跳过的节点并创建任务
    let firstNodeIndex = 0
    while (firstNodeIndex < snapshotNodes.length) {
      const node = snapshotNodes[firstNodeIndex]
      if (evaluateSkipWhen(node.skip_when, fullContext)) {
        firstNodeIndex++
        continue
      }
      break
    }

    if (existingRejected) {
      if (existingRejected.initiator_uid !== currentUser) {
        throw createError({
          statusCode: 409,
          message: `该业务已有历史实例（${existingRejected.instance_no}），仅原发起人可重新提交`
        })
      }

      if (config.allow_resubmit === false) {
        throw createError({
          statusCode: 409,
          message: `该业务已有历史实例（${existingRejected.instance_no}），且当前流程不允许重新提交`
        })
      }

      await execute<ResultSetHeader>(
        `UPDATE flow_instances
         SET action_def_id = ?,
             route_id = ?,
             flow_schema_id = ?,
             biz_title = ?,
             biz_url = ?,
             biz_context = ?,
             form_data = ?,
             attachments = ?,
             status = 'running',
             current_node = ?,
             flow_snapshot = ?,
             callback_url = ?,
             completed_at = NULL,
             updated_at = NOW()
         WHERE id = ?`,
        [
          action_def_id,
          route_id,
          route.flow_schema_id,
          biz_title,
          biz_url || null,
          JSON.stringify(fullContext),
          JSON.stringify(form_data || {}),
          JSON.stringify(attachments || []),
          firstNodeIndex,
          JSON.stringify(flowSnapshot),
          callback_url || null,
          existingRejected.id
        ]
      )

      await execute<ResultSetHeader>(
        'UPDATE flow_tasks SET status = \'cancelled\', updated_at = NOW() WHERE instance_id = ? AND status = \'pending\'',
        [existingRejected.id]
      )

      await execute<ResultSetHeader>(
        `INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, created_at)
         VALUES (?, NULL, ?, 'resubmit', NULL, NOW())`,
        [existingRejected.id, currentUser]
      )

      instanceId = existingRejected.id
      instanceNo = existingRejected.instance_no
      submitMode = 'resubmitted'
    } else {
      // 7. 创建流程实例
      const result = await execute<ResultSetHeader>(
        `INSERT INTO flow_instances
         (instance_no, action_def_id, route_id, flow_schema_id, app_code, resource_code, action_code,
          biz_id, biz_title, biz_url, biz_context, form_data, attachments,
          initiator_uid, status, current_node, flow_snapshot, callback_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, NOW(), NOW())`,
        [
          instanceNo,
          action_def_id,
          route_id,
          route.flow_schema_id,
          actionDef.app_code,
          actionDef.resource_code,
          actionDef.action_code,
          biz_id,
          biz_title,
          biz_url || null,
          JSON.stringify(fullContext),
          JSON.stringify(form_data || {}),
          JSON.stringify(attachments || []),
          currentUser,
          firstNodeIndex,
          JSON.stringify(flowSnapshot),
          callback_url || null
        ]
      )

      instanceId = result.insertId
    }

    if (firstNodeIndex < snapshotNodes.length) {
      const firstNode = snapshotNodes[firstNodeIndex]
      await createTasksForNode(instanceId, firstNodeIndex, firstNode)

      // 首节点若是"发起人自审批"，自动通过并推进
      const autoApproved = await maybeAutoApproveInitiatorNode(
        instanceId,
        firstNodeIndex,
        firstNode,
        currentUser
      )

      // 未自动通过时才通知第一批审批人
      if (!autoApproved) {
        const firstAssignees = firstNode.resolved_assignees
        if (firstAssignees?.length) {
          try {
            await sendNotification({
              touser: firstAssignees.map((a: { uid: string }) => a.uid),
              title: '您有新的审批待办',
              description: `${fullContext.initiator_name || currentUser}提交了「${biz_title}」，请审批`,
              url: biz_url || ''
            })
          } catch (e) {
            console.error('[Instance] 发送通知失败:', e)
          }
        }
      }
    }

    // 重新查实际状态（自审批自动通过后可能已是 approved）
    const finalInstance = await queryRow<RowDataPacket & { status: string, current_node: number }>(
      'SELECT status, current_node FROM flow_instances WHERE id = ?',
      [instanceId]
    )

    return {
      code: 0,
      data: {
        instance_id: instanceId,
        instance_no: instanceNo,
        status: finalInstance?.status || 'running',
        current_node: finalInstance?.current_node ?? firstNodeIndex,
        mode: submitMode,
        flow_snapshot: flowSnapshot
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('发起流程失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '发起流程失败'
    })
  }
})
