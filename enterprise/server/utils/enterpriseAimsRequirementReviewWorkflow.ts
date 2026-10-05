import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { writeHostProjectRequirement } from '../../../aims/layer/server/index'
import { enterpriseAimsDocumentReadPermitProvider } from './enterpriseAimsProjectDocumentPermits'
import { enterpriseAimsProjectScope } from './enterpriseAimsProjects'
import { workflowRequest } from './enterpriseWorkflowProxy'

interface FrozenReview {
  batchId: number
  projectId: number
  actionCode: 'requirement_baseline' | 'requirement_change'
  title: string
  synced: boolean
  workflowInstanceId: string
  formData: { batchId: string, projectId: string, requestedBy: string, snapshotHash: string, requestNo: string }
}
export async function enterpriseAimsRequirementReviewSync(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const input = await readBody<Record<string, unknown>>(event)
  const projectId = String(input?.projectId || '')
  const batchId = String(getRouterParam(event, 'batchId') || '')
  const key = String(getHeader(event, 'Idempotency-Key') || '').trim()
  if (!input || Array.isArray(input) || Object.keys(input).some(k => k !== 'projectId') || Object.keys(getQuery(event)).length || !/^[1-9]\d*$/.test(projectId) || !Number.isSafeInteger(Number(projectId)) || !/^[1-9]\d*$/.test(batchId) || !Number.isSafeInteger(Number(batchId)) || !key || key.length > 180) throw createError({ statusCode: 400, message: '评审提交参数无效' })
  const user = await requireEnterpriseUser(event)
  const provider = enterpriseAimsDocumentReadPermitProvider(event)
  const sync = async () => await writeHostProjectRequirement(event, provider, 'review-sync', projectId, batchId, {}, key, await enterpriseAimsProjectScope(event, user.uid)) as { code: number, data: FrozenReview }
  const frozen = await sync()
  if (frozen.code !== 0 || !frozen.data) throw createError({ statusCode: 503, message: '评审准备未确认，请按同一请求重试' })
  if (frozen.data.synced) return frozen
  const review = frozen.data
  if (String(review.batchId) !== batchId || String(review.projectId) !== projectId || review.formData?.requestedBy !== user.uid || review.formData?.batchId !== batchId || review.formData?.projectId !== projectId || !/^[a-f0-9]{64}$/.test(review.formData?.snapshotHash) || review.formData?.requestNo !== `RRB-${batchId}-${review.formData.snapshotHash}` || !['requirement_baseline', 'requirement_change'].includes(review.actionCode)) throw createError({ statusCode: 503, message: '评审冻结快照不一致' })
  const biz = { app_code: 'aims', resource_code: 'requirements', action_code: review.actionCode, biz_id: batchId, biz_title: review.title, form_data: review.formData }
  const prepared = await workflowRequest<{ code: number, data: { action_def: { id: number, resource_code: string, action_code: string }, matched_routes: { id: number }[] } }>(event, user.uid, 'instances/prepare', { method: 'POST', body: biz })
  const action = prepared.data?.action_def
  if (prepared.code !== 0 || action?.resource_code !== 'requirements' || action.action_code !== review.actionCode || !action.id || !prepared.data.matched_routes?.[0]?.id) throw createError({ statusCode: 503, message: '需求评审流程未配置，请按同一请求重试' })
  const created = await workflowRequest<{ code: number, data: { instance_id: number } }>(event, user.uid, 'instances', { method: 'POST', key: review.formData.requestNo, body: { action_def_id: action.id, route_id: prepared.data.matched_routes[0].id, biz_id: batchId, biz_title: review.title, biz_url: `/aims/projects/${projectId}/requirements`, form_data: review.formData, callback_url: '/api/v1/service/workflow/callback' } })
  if (created.code !== 0 || !Number.isSafeInteger(created.data?.instance_id) || created.data.instance_id <= 0) throw createError({ statusCode: 503, message: '评审创建结果未确认，请按同一请求重试' })
  // Recompute the fresh scoped permit; no browser instance/status is sent to Runtime.
  const bound = await sync()
  if (bound.code !== 0 || !bound.data?.synced || bound.data.workflowInstanceId !== String(created.data.instance_id)) throw createError({ statusCode: 503, message: '评审绑定尚未确认，请按同一请求重试' })
  return bound
}
