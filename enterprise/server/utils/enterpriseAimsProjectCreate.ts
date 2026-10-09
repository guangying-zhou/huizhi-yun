import { createError, getHeader, getQuery, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadProjectCommandAuthorization } from '@hzy/foundation/server/utils/projectCommandAuthorization'
import { projectNameError } from '../../../aims/shared/projectName'
import { enterpriseAimsPersonnel } from './enterpriseAimsPersonnel'

const keys = new Set(['projectCode', 'name', 'shortName', 'internalCode', 'description', 'category', 'methodology', 'portfolioId', 'domainCode', 'deptCode', 'leaderUid', 'securityLevel', 'confidentialityLevel', 'accessWhitelist', 'startDate', 'endDate', 'serviceLineCode', 'servicePeriodSeq', 'servicePeriodStart', 'servicePeriodEnd', 'servicePeriodLabel', 'templateVersionId', 'excludedTemplateWorkItemKeys'])

export async function enterpriseAimsProjectCreate(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '项目创建参数无效' })
  const key = String(getHeader(event, 'Idempotency-Key') || '').trim()
  if (!key || key.length > 191) throw createError({ statusCode: 400, message: '缺少有效操作标识' })
  const input = await readBody<Record<string, unknown>>(event)
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !keys.has(k))) throw createError({ statusCode: 400, message: '项目创建参数无效' })
  const projectCode = typeof input.projectCode === 'string' ? input.projectCode.trim() : ''
  const deptCode = typeof input.deptCode === 'string' ? input.deptCode.trim() : ''
  if (!projectCode || (input.deptCode != null && typeof input.deptCode !== 'string')) throw createError({ statusCode: 400, message: '项目编码或部门无效' })
  // Same rule the Runtime update command enforces; a name accepted here must
  // stay editable afterwards.
  const nameError = projectNameError(input.name)
  if (nameError) throw createError({ statusCode: 400, message: nameError, data: { code: 'project_name_invalid' } })
  const user = await requireEnterpriseUser(event)
  const authorization = await loadProjectCommandAuthorization(event, user, {
    resource: 'projects', action: 'create', projectId: '', workItemId: '', projectCode, deptCode
  })
  await prepareEnterpriseRuntime(event, 'aims.project-create')
  const personnel = await enterpriseAimsPersonnel(event, user, input, 'leaderUid', 'projects', 'new', 'create')
  return await callEnterpriseRuntime(event, 'aims.project-create', {
    personnel, tenant: user.tenant, deployment: user.deployment, input, authorization
  }, { idempotencyKey: key })
}
