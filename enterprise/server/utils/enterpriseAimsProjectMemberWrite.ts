import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { enterpriseAimsPersonnel } from './enterpriseAimsPersonnel'
import { enterpriseAimsProjectWriteAuthorization } from './enterpriseAimsProjectWriteAuthorization'

const numeric = /^[1-9]\d*$/
const roles = new Set(['manager', 'member', 'viewer'])
type Action = 'add' | 'role' | 'remove'

export async function enterpriseAimsProjectMemberWrite(event: H3Event, action: Action) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '成员操作参数无效' })
  const projectId = String(getRouterParam(event, 'id') || '').trim()
  const key = String(getHeader(event, 'Idempotency-Key') || '').trim()
  if (!numeric.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: '项目标识无效' })
  if (!key || key.length > 191) throw createError({ statusCode: 400, message: '缺少有效操作标识' })
  const input = await readBody<Record<string, unknown>>(event)
  const uid = typeof input?.uid === 'string' ? input.uid.trim() : ''
  const role = typeof input?.role === 'string' ? input.role.trim() : ''
  if (!uid || Object.keys(input || {}).some(key => !['uid', 'role'].includes(key)) || (action !== 'remove' && !roles.has(role))) throw createError({ statusCode: 400, message: '成员操作参数无效' })
  const user = await requireEnterpriseUser(event)
  const operation = `aims.project-member-${action}` as const
  await prepareEnterpriseRuntime(event, operation)
  const personnel = action === 'remove' ? [] : await enterpriseAimsPersonnel(event, user, input, 'uid', 'project-members', projectId, action)
  const authorization = await enterpriseAimsProjectWriteAuthorization(event, user, projectId, { resource: 'project-members', action })
  return await callEnterpriseRuntime(event, operation, { personnel, tenant: user.tenant, deployment: user.deployment, projectId, input, authorization }, { idempotencyKey: key })
}
