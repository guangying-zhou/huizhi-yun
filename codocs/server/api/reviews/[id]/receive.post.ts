/**
 * 由发送登记中的指定发送人确认对方已接收。
 */
import { notifyReceiveConfirmed } from '../../../utils/reviewNotify'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface ExecutionResult {
  executionStatus: string
  idempotent: boolean
  initiatorUid: string
  documentTitle: string
}

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  await requirePermission(event, 'reviews', 'view', '缺少发文查看权限')
  const requestId = String(getRouterParam(event, 'id') || '').trim()
  if (!/^\d+$/.test(requestId)) {
    throw createError({ statusCode: 400, message: '发布申请 ID 无效' })
  }
  const body = await readBody<{ receiveDate?: string }>(event)
  const result = await callCodocsTenantRuntime<ExecutionResult>(
    event,
    `/v1/codocs/reviews/publish-requests/${encodeURIComponent(requestId)}/receive`,
    {
      method: 'POST',
      scope: 'codocs.write',
      body: {
        current_user: uid,
        receiveDate: String(body?.receiveDate || '').trim()
      }
    }
  )

  await notifyReceiveConfirmed(result.initiatorUid, result.documentTitle, Number(requestId))
  return { code: 0, message: 'success', data: result }
})
