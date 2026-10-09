import { owningCreateError as createError, type OwningH3Event as H3Event } from '@hzy/foundation/server/utils/owningModuleHttp'
import { callEnterpriseRuntime, requireEnterpriseUser, enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadProjectCommandAuthorization } from '@hzy/foundation/server/utils/projectCommandAuthorization'
import { loadAuthorizationSnapshotFromConsoleRuntime, loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { projectAuthorizationObjectFromFacts } from '../../../server/utils/aimsProjectAuthorizationObjectCore'
import { requireAimsProjectAuthorizationRecord } from '../../../server/utils/aimsProjectAuthorizationRecord'

export type DocumentReadPermitProvider = (projectId: string) => Promise<{ query: Record<string, string>, authorization: Record<string, unknown> }>
export interface HostProjectDocumentContext {
  title?: string
  project: Record<string, unknown>
  projectId: string
  projectCode: string
  deptCode: string
  isMember: boolean
  isManager: boolean
  isScopedProjectAdmin: boolean
  actorProjectCodes: string[]
  actorDeptCodes: string[]
  actorRoles: string[]
  document?: Record<string, unknown>
  documentRefType?: 'codocs_document' | 'cabinet_file'
  documentUuid?: string
}

export async function documentActor(event: H3Event, action: 'view' | 'edit') {
  const user = await requireEnterpriseUser(event)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'projects', action, snapshot.actionPolicies?.projects)) throw createError({ statusCode: 403, message: '无项目文档操作权限' })
  return user
}

export function documentEnvelope<T>(response: { code?: number, data?: T }): T {
  if (response.code !== 0 || response.data === undefined) throw createError({ statusCode: 503, message: '项目文档运行服务响应无效' })
  return response.data
}

export async function hostProjectDocumentContext<T = HostProjectDocumentContext>(event: H3Event, provider: DocumentReadPermitProvider, projectId: string, documentId?: string, repoProjectCode?: string, documentUuid?: string, accessAction?: 'view' | 'download' | 'edit', repositoryRead?: { operation: 'file' | 'markdown-tree', path?: string, ref?: string, commitId?: string }) {
  const user = await documentActor(event, 'view')
  const permit = await provider(projectId)
  const { projectId: _parentId, ...projectAuthorization } = permit.authorization
  const project = documentEnvelope(await callEnterpriseRuntime<{ code: number, data: Record<string, unknown> }>(event, 'aims.project-view', { tenant: user.tenant, deployment: user.deployment, projectId, authorization: projectAuthorization, query: permit.query }))
  const object = projectAuthorizationObjectFromFacts(requireAimsProjectAuthorizationRecord(project, projectId), project.members as Record<string, unknown>[], user.uid, projectId)
  const admin = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'aims', { resourceCode: 'projects', action: 'admin', object })
  return documentEnvelope(await callEnterpriseRuntime<{ code: number, data: T }>(event, repositoryRead ? 'aims.project-document-repository-read' : accessAction ? 'aims.project-document-access-check' : 'aims.project-document-context', {
    tenant: user.tenant, deployment: user.deployment, projectId, documentId, repoProjectCode, documentUuid,
    ...(accessAction ? { accessAction } : {}),
    ...(repositoryRead ? { repositoryRead } : {}),
    projectAdmin: admin.decision?.allowed === true,
    projectReadAuthorization: permit.authorization,
    projectScopeQuery: permit.query,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'projects', action: 'view', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }))
}

export async function hostDocumentOwner(event: H3Event, payload: Record<string, unknown>, documentId?: string) {
  const user = await documentActor(event, 'edit')
  const projectWriteAuthorization = { ...await loadProjectCommandAuthorization(event, user, { resource: 'projects', action: 'edit', projectId: '', workItemId: '' }), objectId: documentId || '', subId: '' }
  const result = documentEnvelope(await callEnterpriseRuntime<{ code: number, data: { projectId: string } }>(event, 'aims.project-document-owner', {
    tenant: user.tenant, deployment: user.deployment, projectId: '', objectId: documentId || '', ...(documentId ? {} : { payload }), projectWriteAuthorization,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'projects', action: 'edit', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }))
  if (!/^[1-9]\d*$/.test(result.projectId) || !Number.isSafeInteger(Number(result.projectId))) throw createError({ statusCode: 503, message: '文档所属项目响应无效' })
  return result.projectId
}

export async function hostDocumentWrite(event: H3Event, action: 'create' | 'summary' | 'delete', context: HostProjectDocumentContext, payload: Record<string, unknown>, documentId?: string) {
  const user = await documentActor(event, 'edit')
  const projectId = context.projectId
  const projectWriteAuthorization = { ...await loadProjectCommandAuthorization(event, user, { resource: 'projects', action: 'edit', projectId, workItemId: '' }), objectId: documentId || '', subId: '' }
  return await callEnterpriseRuntime(event, `aims.project-document-${action}`, {
    tenant: user.tenant, deployment: user.deployment, projectId, objectId: documentId || '', ...(action === 'delete' ? {} : { payload }), projectWriteAuthorization, projectAdmin: context.isScopedProjectAdmin,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'projects', action: 'edit', expiresAt: enterpriseRuntimePermitExpiresAt() }
  })
}
