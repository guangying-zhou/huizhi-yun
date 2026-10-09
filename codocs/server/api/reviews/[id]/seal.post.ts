/**
 * 确认 Workflow 对外发文发布版本已完成盖章。
 */
import { notifySealConfirmed } from '../../../utils/reviewNotify'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

const SEAL_TYPES = new Set(['official', 'legal', 'finance', 'contract'])

interface ExecutionResult {
  id: number
  executionStatus: string
  idempotent: boolean
  initiatorUid: string
  documentTitle: string
}

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event, '未登录')
  await requirePermission(event, 'reviews', 'admin', '仅发文执行管理员可确认盖章')
  const requestId = String(getRouterParam(event, 'id') || '').trim()
  if (!/^\d+$/.test(requestId)) {
    throw createError({ statusCode: 400, message: '发布申请 ID 无效' })
  }

  const body = await readBody<{
    sealTypes?: unknown[]
    pageCount?: number
    remark?: string | null
  }>(event)
  const sealTypes = [...new Set(
    (Array.isArray(body?.sealTypes) ? body.sealTypes : [])
      .map(value => String(value || '').trim())
      .filter(value => SEAL_TYPES.has(value))
  )]
  const pageCount = Number(body?.pageCount)
  const remark = String(body?.remark || '').trim()
  if (!sealTypes.length) {
    throw createError({ statusCode: 400, message: '请至少选择一种盖章类型' })
  }
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw createError({ statusCode: 400, message: '文档页数必须为正整数' })
  }

  const result = await callCodocsTenantRuntime<ExecutionResult>(
    event,
    `/v1/codocs/reviews/publish-requests/${encodeURIComponent(requestId)}/seal`,
    {
      method: 'POST',
      scope: 'codocs.write',
      body: {
        current_user: uid,
        sealTypes,
        pageCount,
        remark: remark || null
      }
    }
  )

  await notifySealConfirmed(result.initiatorUid, result.documentTitle, Number(requestId))
  return { code: 0, message: 'success', data: result }
})
