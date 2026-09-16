import { setResponseStatus } from 'h3'
import { forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'
import { requireServiceScope } from '~~/server/utils/serviceAuth'
import { dispatchMilestoneReceivableOperation } from '~~/server/utils/serviceTicketDeliveryOperation'

interface CallbackResult {
  requestId?: number
  requestNo?: string
  milestoneId?: number
  projectId?: number
  lifecycleStatus?: string
  activatedMilestoneId?: number
  status: 'approved' | 'rejected'
  alreadyApplied?: boolean
  nextMilestoneId?: number | null
  receivableBillable?: {
    operationKey?: string
    operationStatus?: string
  }
}

function text(value: unknown) {
  return String(value || '').trim()
}

function callbackBody(raw: Record<string, unknown>) {
  const formData = raw.form_data && typeof raw.form_data === 'object' && !Array.isArray(raw.form_data)
    ? raw.form_data as Record<string, unknown>
    : {}
  return {
    event: text(raw.event),
    instance_id: text(raw.instance_id),
    instance_no: text(raw.instance_no),
    app_code: text(raw.app_code),
    resource_code: text(raw.resource_code),
    action_code: text(raw.action_code),
    biz_id: text(raw.biz_id),
    status: text(raw.status),
    initiator_uid: text(raw.initiator_uid),
    form_data: {
      completionRequestId: Number(formData.completionRequestId || 0),
      requestNo: text(formData.requestNo),
      snapshotSha256: text(formData.snapshotSha256),
      projectDirectorUid: text(formData.projectDirectorUid),
      projectDirectorRevision: Number(formData.projectDirectorRevision || 0),
      projectDirectorRoleCode: text(formData.projectDirectorRoleCode),
      projectId: Number(formData.projectId || formData.project_id || 0)
    }
  }
}

export default defineEventHandler(async (event) => {
  await requireServiceScope(event, { scope: 'workflow:callback', allowedApps: ['workflow'] })
  const raw = await readBody<Record<string, unknown>>(event).catch(() => ({}))
  const data = await forwardAimsRuntimePost<CallbackResult>(
    event,
    '/v1/aims/service/workflow/callback',
    {
      uid: 'workflow',
      query: { workflow_callback_verified: '1' },
      body: callbackBody(raw)
    }
  )
  const operationKey = text(data.receivableBillable?.operationKey)
  const operationStatus = text(data.receivableBillable?.operationStatus)
  const receivableBillable = !operationKey
    ? null
    : operationStatus === 'succeeded'
      ? { linked: true, synced: true, pending: false, operation: data.receivableBillable }
      : await dispatchMilestoneReceivableOperation(event, operationKey)
  if (receivableBillable?.pending) setResponseStatus(event, 202)
  return {
    code: 0,
    message: 'ok',
    data: {
      ...data,
      receivableBillable
    }
  }
})
