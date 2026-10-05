import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { writeHostDeliverableQuality, type QualityAction } from '../../../aims/layer/server/index'
import { enterpriseAimsProjectScope } from './enterpriseAimsProjects'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'

export async function enterpriseAimsDeliverableQuality(event: H3Event, action: QualityAction) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '质量动作不接受查询参数' })
  const body = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, message: '质量动作请求体无效' })
  const user = await requireEnterpriseUser(event)
  return await writeHostDeliverableQuality(event, action, getRouterParam(event, 'id') || '', getRouterParam(event, action === 'completeness' ? 'submissionId' : 'deliverableId') || '', body, getHeader(event, 'Idempotency-Key') || '', await enterpriseAimsProjectScope(event, user.uid))
}
