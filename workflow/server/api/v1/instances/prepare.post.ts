/**
 * POST /api/v1/instances/prepare
 * 准备发起流程：收集上下文、匹配路由、返回表单和流程预览
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { queryRow } from '~~/server/utils/db'
import { matchRoutes } from '~~/server/utils/routeMatcher'
import { collectInitiatorContext } from '~~/server/utils/flowEngine'
import { maybeCallWorkflowDataRuntime } from '~~/server/utils/dataRuntime'

interface ActionDefRow extends RowDataPacket {
  id: number
  app_code: string
  resource_code: string
  action_code: string
  name: string
  form_schema_id: number | null
}

interface FormSchemaRow extends RowDataPacket {
  id: number
  code: string
  name: string
  fields: string
}

interface FlowSchemaRow extends RowDataPacket {
  id: number
  code: string
  name: string
  nodes: string
}

interface WorkflowPrepareResponse {
  code: number
  data: {
    action_def: {
      id: number
      name: string
      resource_code: string
      action_code: string
    }
    context: Record<string, unknown>
    matched_routes: Array<Record<string, unknown>>
    form_schema: Record<string, unknown> | null
    prefilled_data: Record<string, unknown>
  }
}

export default defineEventHandler(async (event) => {
  const currentUser = getRequestUid(event)
  if (!currentUser) {
    throw createError({ statusCode: 401, message: '未登录' })
  }

  const body = await readBody(event)
  const { app_code, resource_code, action_code, biz_id, biz_title, biz_context, form_data } = body

  if (!app_code || !resource_code || !action_code) {
    throw createError({
      statusCode: 400,
      message: 'app_code, resource_code 和 action_code 必填'
    })
  }

  const initiatorContext = await collectInitiatorContext(currentUser)
  const runtime = await maybeCallWorkflowDataRuntime<WorkflowPrepareResponse>(event, '/v1/workflow/instances/prepare', {
    scope: 'workflow.write',
    method: 'POST',
    body: {
      ...body,
      current_user: currentUser,
      initiator_context: initiatorContext
    }
  })
  if (runtime.handled) return runtime.data

  try {
    // 1. 查找动作定义
    const actionDef = await queryRow<ActionDefRow>(
      'SELECT * FROM flow_action_defs WHERE app_code = ? AND resource_code = ? AND action_code = ? AND status = 1',
      [app_code, resource_code, action_code]
    )

    if (!actionDef) {
      throw createError({
        statusCode: 404,
        message: '未找到对应的动作定义'
      })
    }

    // 2. 收集发起人上下文
    // 合并业务上下文
    const fullContext: Record<string, unknown> = {
      ...initiatorContext,
      ...(biz_context || {}),
      biz_id,
      biz_title,
      form_data: form_data || {}
    }

    // 3. 路由匹配
    const matchedRouteRows = await matchRoutes(actionDef.id, fullContext)

    // 获取匹配路由对应的流程定义
    const matchedRoutes = []
    for (const route of matchedRouteRows) {
      const flowSchema = await queryRow<FlowSchemaRow>(
        'SELECT id, code, name, nodes FROM flow_schemas WHERE id = ? AND status = 1',
        [route.flow_schema_id]
      )

      if (flowSchema) {
        const nodes = typeof flowSchema.nodes === 'string'
          ? JSON.parse(flowSchema.nodes)
          : flowSchema.nodes

        matchedRoutes.push({
          id: route.id,
          name: route.name,
          level: route.level ?? null,
          flow_schema: {
            id: flowSchema.id,
            code: flowSchema.code,
            name: flowSchema.name,
            nodes_preview: nodes.map((n: { name: string }) => n.name)
          }
        })
      }
    }

    // 4. 获取表单定义
    let formSchema = null
    const prefilledData: Record<string, unknown> = {}

    if (actionDef.form_schema_id) {
      const formRow = await queryRow<FormSchemaRow>(
        'SELECT id, code, name, fields FROM form_schemas WHERE id = ? AND status = 1',
        [actionDef.form_schema_id]
      )

      if (formRow) {
        const fields = typeof formRow.fields === 'string'
          ? JSON.parse(formRow.fields)
          : formRow.fields

        formSchema = {
          id: formRow.id,
          code: formRow.code,
          name: formRow.name,
          fields
        }

        // 预填充 source=biz 的字段
        for (const field of fields) {
          if (field.source === 'biz' && biz_context?.[field.key] !== undefined) {
            prefilledData[field.key] = biz_context[field.key]
          }
        }
        // biz_title 通常映射到 title 字段
        if (biz_title) {
          prefilledData.title = biz_title
        }
      }
    }

    return {
      code: 0,
      data: {
        action_def: {
          id: actionDef.id,
          name: actionDef.name,
          resource_code: actionDef.resource_code,
          action_code: actionDef.action_code
        },
        context: {
          dept_code: fullContext.dept_code,
          dept_name: fullContext.dept_name,
          dept_org_type: fullContext.dept_org_type,
          initiator_uid: currentUser,
          initiator_name: fullContext.initiator_name,
          initiator_roles: fullContext.initiator_roles
        },
        matched_routes: matchedRoutes,
        form_schema: formSchema,
        prefilled_data: prefilledData
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('准备发起流程失败:', error)
    throw createError({
      statusCode: 500,
      message: error.message || '准备发起流程失败'
    })
  }
})
