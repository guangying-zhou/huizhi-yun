import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import {
  callEnterpriseRuntime,
  enterpriseRuntimePermitExpiresAt,
  prepareEnterpriseRuntime,
  requireEnterpriseUser
} from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { enterpriseAimsProjectScope } from './enterpriseAimsProjects'

const listQueryKeys = new Set(['page', 'pageSize', 'search', 'role', 'status'])
const numericID = /^[1-9]\d*$/

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function listInput(event: H3Event) {
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(getQuery(event))) {
    if (!listQueryKeys.has(key) || Array.isArray(raw)) throw createError({ statusCode: 400, message: '成员筛选参数无效' })
    const value = text(raw)
    if (!value || value.length > 200) throw createError({ statusCode: 400, message: '成员筛选参数无效' })
    result[key] = value
  }
  return result
}

export async function enterpriseAimsProjectMemberList(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const projectId = text(getRouterParam(event, 'id'))
  if (!numericID.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: '项目标识无效' })
  const query = listInput(event)
  const user = await requireEnterpriseUser(event)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(authorization.resources, 'projects', 'view', authorization.actionPolicies?.projects)) {
    throw createError({ statusCode: 403, message: '无项目查看权限' })
  }
  await prepareEnterpriseRuntime(event, 'aims.project-member-list')
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  return await callEnterpriseRuntime(event, 'aims.project-member-list', {
    tenant: user.tenant,
    deployment: user.deployment,
    projectId,
    query: { ...query, ...scope },
    authorization: {
      actorUid: user.uid,
      tenant: user.tenant,
      deployment: user.deployment,
      resource: 'projects',
      action: 'view',
      expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  })
}
