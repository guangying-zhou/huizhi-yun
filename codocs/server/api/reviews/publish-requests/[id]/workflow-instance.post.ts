/**
 * 绑定 Workflow 实例到发布申请
 * POST /api/reviews/publish-requests/:id/workflow-instance
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

const normalizeStatus = (value: string) => {
  return ['running', 'approved', 'rejected', 'cancelled'].includes(value) ? value : 'running'
}

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '缺少发布申请ID' })
  }

  const body = await readBody(event)
  const source = body?.data || body || {}
  const instanceId = Number(
    source.instanceId
    || source.instance_id
    || source.workflow_instance_id
    || source.id
    || 0
  )
  const instanceNo = String(
    source.instanceNo
    || source.instance_no
    || source.workflow_instance_no
    || ''
  ).trim()
  const status = normalizeStatus(String(source.status || 'running').trim())

  if (!Number.isInteger(instanceId) || instanceId <= 0) {
    throw createError({ statusCode: 400, message: '缺少 Workflow 实例ID' })
  }

  const data = await callCodocsTenantRuntime(event, `/v1/codocs/reviews/publish-requests/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    scope: 'codocs.write',
    body: {
      workflow_instance_id: instanceId,
      workflow_instance_no: instanceNo || null,
      workflow_status: status,
      current_user: uid,
      operator_uid: uid
    }
  })

  return {
    code: 0,
    message: 'success',
    data
  }
})
