import { owningCreateError as createError, type OwningH3Event as H3Event } from '@hzy/foundation/server/utils/owningModuleHttp'
import { callEnterpriseRuntime, requireEnterpriseUser, prepareEnterpriseRuntime, enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { loadProjectCommandAuthorization } from '@hzy/foundation/server/utils/projectCommandAuthorization'
import type { DocumentReadPermitProvider } from './projectDocumentPorts'
import { isValidHostGitRepositoryPath } from './projectDocumentSources'

export async function readHostProjectOutput(event: H3Event, provider: DocumentReadPermitProvider, projectId: string, query: Record<string, string>) {
  if (!/^[1-9]\d*$/.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: '项目标识无效' })
  const user = await requireEnterpriseUser(event)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'projects', 'view', snapshot.actionPolicies?.projects)) throw createError({ statusCode: 403, message: '无项目查看权限' })
  const scope = await provider(projectId)
  await prepareEnterpriseRuntime(event, 'aims.project-output-overview')
  return await callEnterpriseRuntime(event, 'aims.project-output-overview', {
    tenant: user.tenant, deployment: user.deployment, projectId, query: { ...query, ...scope.query }, projectReadAuthorization: scope.authorization,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'projects', action: 'view', expiresAt: enterpriseRuntimePermitExpiresAt() }
  })
}

export async function readHostProjectRepoCandidates(event: H3Event, projectId: string) {
  if (!/^[1-9]\d*$/.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: '项目标识无效' })
  const user = await requireEnterpriseUser(event)
  const edit = await loadProjectCommandAuthorization(event, user, { resource: 'projects', action: 'edit', projectId, workItemId: '' })
  await prepareEnterpriseRuntime(event, 'aims.project-repo-candidates')
  const res = await callEnterpriseRuntime<{ code: number, data: { projectId: string, gitGroup: string } }>(event, 'aims.project-repo-candidates', {
    tenant: user.tenant, deployment: user.deployment, projectId,
    projectWriteAuthorization: { ...edit, objectId: '', subId: '' },
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'project-repos', action: 'edit', expiresAt: enterpriseRuntimePermitExpiresAt() }
  })
  if (res.code !== 0 || res.data?.projectId !== projectId || typeof res.data.gitGroup !== 'string' || (res.data.gitGroup && !isValidHostGitRepositoryPath(res.data.gitGroup))) throw createError({ statusCode: 503, message: '仓库目录响应无效' })
  if (!res.data.gitGroup) return { code: 0, data: { items: [], gitGroup: null } }
  const group = res.data.gitGroup
  const { listGitGroupProjects } = await import('@hzy/foundation/server/utils/gitIntegration')
  const response = await listGitGroupProjects({ groupPath: group, includeArchived: false })
  if (!Array.isArray(response.items) || response.items.some(item => !isValidHostGitRepositoryPath(item.projectCode) || !item.projectCode.startsWith(`${group}/`))) throw createError({ statusCode: 503, message: '仓库目录响应越出已登记范围' })
  return { code: 0, data: { gitGroup: group, items: response.items.map(item => ({ projectCode: item.projectCode, name: item.name })) } }
}
