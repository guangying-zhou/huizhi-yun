import { getRequestUid } from '~~/server/utils/authIdentity'
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) throw createError({ statusCode: 401, message: '请先登录' })
  const requestId = Number(getRouterParam(event, 'requestId'))
  if (!Number.isSafeInteger(requestId) || requestId <= 0) {
    throw createError({ statusCode: 400, message: '无效的完成申请ID' })
  }
  await requirePermission(event, 'projects', 'edit', '需要项目维护权限才可以绑定里程碑完成审批')
  const body = await readBody<{ workflowInstanceId?: unknown }>(event)
  const workflowInstanceId = Number(body.workflowInstanceId)
  if (!Number.isSafeInteger(workflowInstanceId) || workflowInstanceId <= 0) {
    throw createError({ statusCode: 400, message: '无效的 Workflow 实例ID' })
  }
  const data = await forwardAimsRuntimePost<Record<string, unknown>>(
    event,
    `/v1/aims/milestone-completion-requests/${requestId}:bind-workflow`,
    {
      uid,
      query: { current_user_completion_request_authorized: '1' },
      body: { workflowInstanceId }
    }
  )
  return { code: 0, data }
})
