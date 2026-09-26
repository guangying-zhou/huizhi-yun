import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { enterpriseAimsPersonnel } from './enterpriseAimsPersonnel'

const numericID = /^[1-9]\d*$/
const fields = new Set(['expectedVersion', 'name', 'shortName', 'internalCode', 'description', 'methodology', 'portfolioId', 'domainCode', 'deptCode', 'leaderUid', 'startDate', 'endDate'])

export async function enterpriseAimsProjectUpdate(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '项目编辑参数无效' })
  const projectId = String(getRouterParam(event, 'id') || '').trim()
  if (!numericID.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: '项目标识无效' })
  const key = String(getHeader(event, 'Idempotency-Key') || '').trim()
  if (!key || key.length > 191) throw createError({ statusCode: 400, message: '缺少有效操作标识' })
  const input = await readBody<Record<string, unknown>>(event)
  if (!input || Array.isArray(input) || !Object.keys(input).length || Object.keys(input).some(key => !fields.has(key))) throw createError({ statusCode: 400, message: '项目基本信息参数无效' })
  const user = await requireEnterpriseUser(event)
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'aims', { resourceCode: 'projects', action: 'edit' })
  if (scoped.decision?.allowed !== true) throw createError({ statusCode: 403, message: '当前用户没有项目编辑权限' })
  await prepareEnterpriseRuntime(event, 'aims.project-edit')
  const personnel = await enterpriseAimsPersonnel(event,user,input,'leaderUid','projects',projectId,'edit')
  return await callEnterpriseRuntime(event, 'aims.project-edit', { personnel, tenant: user.tenant, deployment: user.deployment, projectId, input, authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'projects', action: 'edit', projectId, allowed: true, expiresAt: enterpriseRuntimePermitExpiresAt() } }, { idempotencyKey: key })
}
