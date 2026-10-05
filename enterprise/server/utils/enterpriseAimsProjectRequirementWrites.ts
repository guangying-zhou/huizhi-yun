import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { writeHostProjectRequirement, type RequirementWriteAction } from '../../../aims/layer/server/index'
import { enterpriseAimsDocumentReadPermitProvider } from './enterpriseAimsProjectDocumentPermits'
import { enterpriseAimsProjectScope } from './enterpriseAimsProjects'

export async function enterpriseAimsRequirementWrite(event: H3Event, action: RequirementWriteAction) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '需求写入不接受查询参数' })
  const user = await requireEnterpriseUser(event)
  const raw = await readBody<Record<string, unknown>>(event)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw createError({ statusCode: 400, message: '需求操作参数无效' })
  const { projectId: suppliedProjectId, ...payload } = raw
  const projectLevel = action === 'create' || action === 'content-create' || action === 'import' || action === 'review-create'
  const projectId = projectLevel ? String(getRouterParam(event, 'id') || '') : String(suppliedProjectId || '')
  if (projectLevel && suppliedProjectId !== undefined && String(suppliedProjectId) !== projectId) throw createError({ statusCode: 400, message: '项目标识不一致' })
  const objectId = projectLevel ? '' : String(getRouterParam(event, action.startsWith('review-') ? 'batchId' : action === 'update' || action === 'delete' || action === 'change-create' || action === 'task-create' ? 'reqId' : 'contentId') || '')
  const key = String(getHeader(event, 'Idempotency-Key') || '').trim()
  return await writeHostProjectRequirement(event, enterpriseAimsDocumentReadPermitProvider(event), action, projectId, objectId, payload, key, await enterpriseAimsProjectScope(event, user.uid))
}
