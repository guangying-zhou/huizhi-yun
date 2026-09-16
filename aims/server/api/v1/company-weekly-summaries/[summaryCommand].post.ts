import { getRequestUid } from '~~/server/utils/authIdentity'
import { forwardAimsRuntimeGet, forwardAimsRuntimePost } from '~~/server/utils/aimsRuntimeForward'
import { dispatchCompanyWeeklySummaryOperation } from '~~/server/utils/serviceTicketDeliveryOperation'
import { requirePermission } from '~~/server/utils/checkPermission'
import { resolveCompanyWeeklySummaryRecipients } from '~~/server/utils/companyWeeklySummaryRecipients'
import { requireCurrentProjectGovernanceRoleHolder } from '~~/server/utils/projectGovernanceRoleHolder'

interface SummaryProjection {
  generated?: boolean
  status?: string
  recipientSelections?: Array<Record<string, unknown>>
}

interface PublishResult {
  summaryId: number
  summaryVersionId: number
  revisionNo: number
  periodKey: string
  status: 'publishing'
  markdownSha256: string
  operation?: {
    operationKey?: string
  }
}

function commandFromRoute(event: Parameters<typeof getRouterParam>[0]) {
  const command = String(getRouterParam(event, 'summaryCommand') || '').trim()
  const match = /^(.+):(publish|retry)$/.exec(command)
  if (!match?.[1] || !match[2]) {
    throw createError({ statusCode: 404, message: '公司项目周报汇总操作不存在' })
  }
  const periodKey = match[1]
  if (!/^[0-9]{4}-W(?:0[1-9]|[1-4][0-9]|5[0-3])$/.test(periodKey)) {
    throw createError({ statusCode: 400, message: '无效的周报周期' })
  }
  return { periodKey, action: match[2] as 'publish' | 'retry' }
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) throw createError({ statusCode: 401, message: '请先登录' })
  await requirePermission(event, 'weekly_reports', 'review', '仅当前项目总监可以发布公司项目周报汇总')
  const director = await requireCurrentProjectGovernanceRoleHolder(event, 'project_director', uid)
  const { periodKey, action } = commandFromRoute(event)
  const body = await readBody<{ correctionReason?: unknown }>(event).catch(
    (): { correctionReason?: unknown } => ({})
  )
  const directorQuery = {
    current_user_is_project_director: '1',
    current_user_project_director_revision: String(director.revision)
  }
  if (action === 'retry') {
    const retried = await forwardAimsRuntimePost<{
      operationKey: string
      operationStatus: string
      summaryVersionId: number
    }>(
      event,
      `/v1/aims/company-weekly-summaries/${encodeURIComponent(periodKey)}:retry`,
      { uid, query: directorQuery }
    )
    const delivery = await dispatchCompanyWeeklySummaryOperation(event, retried.operationKey)
    return { code: 0, data: { ...retried, delivery } }
  }
  const summary = await forwardAimsRuntimeGet<SummaryProjection>(
    event,
    `/v1/aims/company-weekly-summaries/${encodeURIComponent(periodKey)}`,
    { uid, query: directorQuery }
  )
  if (!summary.generated) {
    throw createError({ statusCode: 409, message: '请先生成公司项目周报汇总草稿' })
  }
  const recipients = await resolveCompanyWeeklySummaryRecipients(event, summary.recipientSelections)
  const prepared = await forwardAimsRuntimePost<PublishResult>(
    event,
    `/v1/aims/company-weekly-summaries/${encodeURIComponent(periodKey)}:publish`,
    {
      uid,
      query: {
        ...directorQuery,
        company_summary_recipient_resolution_verified: '1'
      },
      body: {
        correctionReason: String(body.correctionReason || '').trim() || undefined,
        resolvedRecipients: recipients.resolvedRecipients,
        coveredSelectionKeys: recipients.coveredSelectionKeys
      }
    }
  )
  const operationKey = String(prepared.operation?.operationKey || '').trim()
  const delivery = operationKey
    ? await dispatchCompanyWeeklySummaryOperation(event, operationKey)
    : { linked: false, synced: false, pending: true }
  return {
    code: 0,
    data: {
      ...prepared,
      delivery,
      status: delivery.synced ? 'published' : prepared.status
    }
  }
})
