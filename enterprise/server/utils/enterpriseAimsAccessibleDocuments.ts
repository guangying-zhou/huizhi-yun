import { createError, getQuery, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime, loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'

import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { resolveAimsProjectAuthorizationObject } from '../../../aims/server/utils/aimsScopedAuthorization'
import { enterpriseAimsProjectReadPermit } from './enterpriseAimsProjects'

export async function enterpriseAimsAccessibleProjectDocuments(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const query = getQuery(event)
  if (Object.keys(query).some(key => !['projectId', 'project_id'].includes(key)) || (query.projectId !== undefined && query.project_id !== undefined)) throw createError({ statusCode: 400, message: '项目文档筛选参数无效' })
  const projectId = query.projectId ?? query.project_id
  if (typeof projectId !== 'string' || !/^[1-9][0-9]{0,17}$/.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: '请选择项目' })
  const user = await requireEnterpriseUser(event)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'projects', 'view', snapshot.actionPolicies?.projects)) throw createError({ statusCode: 403, message: '无项目文档查看权限' })
  const permit = await enterpriseAimsProjectReadPermit(event, user)
  const project = await callEnterpriseRuntime<{ code: number, data: Record<string, unknown> }>(event, 'aims.project-view', {
    tenant: user.tenant, deployment: user.deployment, projectId, ...permit
  })
  if (project.code !== 0) throw createError({ statusCode: 503, message: '项目授权事实不完整' })
  const object = await resolveAimsProjectAuthorizationObject(event, { projectId, uid: user.uid }, async () => project.data)
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'aims', { resourceCode: 'projects', action: 'view', object })
  if (scoped.decision?.allowed !== true) throw createError({ statusCode: 403, message: '无项目文档查看权限' })
  const admin = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'aims', { resourceCode: 'projects', action: 'admin', object })
  await prepareEnterpriseRuntime(event, 'aims.project-document-accessible-list')
  return await callEnterpriseRuntime(event, 'aims.project-document-accessible-list', {
    tenant: user.tenant, deployment: user.deployment, projectId,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'projects', action: 'view', projectId, projectAdmin: admin.decision?.allowed === true, allowed: true, expiresAt: enterpriseRuntimePermitExpiresAt() }
  })
}
