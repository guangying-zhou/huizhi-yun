import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { enterpriseAimsProjectWriteAuthorization } from './enterpriseAimsProjectWriteAuthorization'
import { enterpriseAimsPersonnel } from './enterpriseAimsPersonnel'

const numericID = /^[1-9]\d*$/
export const enterpriseProjectUpdateFields = new Set(['expectedVersion', 'name', 'shortName', 'internalCode', 'description', 'methodology', 'portfolioId', 'domainCode', 'deptCode', 'leaderUid', 'startDate', 'endDate', 'securityLevel', 'confidentialityLevel', 'accessWhitelist'])
const securityLevels = new Set(['company', 'department', 'project_team', 'whitelist'])
const confidentialityLevels = new Set(['L0', 'L1', 'L2', 'L3'])

export async function enterpriseAimsProjectUpdate(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '项目编辑参数无效' })
  const projectId = String(getRouterParam(event, 'id') || '').trim()
  if (!numericID.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: '项目标识无效' })
  const key = String(getHeader(event, 'Idempotency-Key') || '').trim()
  if (!key || key.length > 191) throw createError({ statusCode: 400, message: '缺少有效操作标识' })
  const input = await readBody<Record<string, unknown>>(event)
  if (!input || Array.isArray(input) || !Object.keys(input).length || Object.keys(input).some(key => !enterpriseProjectUpdateFields.has(key))) throw createError({ statusCode: 400, message: '项目基本信息参数无效' })
  if ('securityLevel' in input && (typeof input.securityLevel !== 'string' || !securityLevels.has(input.securityLevel))) throw createError({ statusCode: 400, message: '项目可见范围无效' })
  if ('confidentialityLevel' in input && (typeof input.confidentialityLevel !== 'string' || !confidentialityLevels.has(input.confidentialityLevel))) throw createError({ statusCode: 400, message: '项目密级无效' })
  if ('accessWhitelist' in input && (!Array.isArray(input.accessWhitelist) || input.accessWhitelist.length > 100 || input.accessWhitelist.some(uid => typeof uid !== 'string' || !uid || uid.trim() !== uid || [...uid].length > 64))) throw createError({ statusCode: 400, message: '项目白名单无效' })
  const user = await requireEnterpriseUser(event)
  await prepareEnterpriseRuntime(event, 'aims.project-edit')
  const personnel = await enterpriseAimsPersonnel(event, user, input, 'leaderUid', 'projects', projectId, 'edit')
  const authorization = await enterpriseAimsProjectWriteAuthorization(event, user, projectId, { resource: 'projects', action: 'edit' })
  return await callEnterpriseRuntime(event, 'aims.project-edit', { personnel, tenant: user.tenant, deployment: user.deployment, projectId, input, authorization }, { idempotencyKey: key })
}
