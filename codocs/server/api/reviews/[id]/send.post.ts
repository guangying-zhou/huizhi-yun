/**
 * 登记 Workflow 对外发文发布版本的实际发送信息。
 */
import { notifyPendingReceive, notifySendConfirmed } from '../../../utils/reviewNotify'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface ExecutionResult {
  id: number
  executionStatus: string
  idempotent: boolean
  initiatorUid: string
  senderUid: string
  documentTitle: string
}

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  await requirePermission(event, 'reviews', 'archive', '缺少发文执行权限')
  const requestId = String(getRouterParam(event, 'id') || '').trim()
  if (!/^\d+$/.test(requestId)) {
    throw createError({ statusCode: 400, message: '发布申请 ID 无效' })
  }
  const body = await readBody<Record<string, unknown>>(event)
  const result = await callCodocsTenantRuntime<ExecutionResult>(
    event,
    `/v1/codocs/reviews/publish-requests/${encodeURIComponent(requestId)}/send`,
    {
      method: 'POST',
      scope: 'codocs.write',
      body: {
        current_user: uid,
        senderUid: String(body?.senderUid || '').trim(),
        receiverName: String(body?.receiverName || '').trim(),
        receiverPhone: String(body?.receiverPhone || '').trim(),
        channel: String(body?.channel || '').trim(),
        sentDate: String(body?.sentDate || '').trim(),
        targetAccount: String(body?.targetAccount || '').trim() || null,
        remark: String(body?.remark || '').trim() || null
      }
    }
  )

  await notifySendConfirmed(result.initiatorUid, result.documentTitle, Number(requestId))
  if (result.senderUid && result.senderUid !== result.initiatorUid) {
    await notifyPendingReceive(result.senderUid, result.documentTitle, Number(requestId))
  }
  return { code: 0, message: 'success', data: result }
})
