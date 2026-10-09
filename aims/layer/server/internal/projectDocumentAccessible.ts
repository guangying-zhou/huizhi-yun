import { owningCreateError as createError, type OwningH3Event as H3Event } from '@hzy/foundation/server/utils/owningModuleHttp'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { projectAuthorizationObjectFromFacts } from '../../../server/utils/aimsProjectAuthorizationObjectCore'
import { requireAimsProjectAuthorizationRecord } from '../../../server/utils/aimsProjectAuthorizationRecord'
import { documentActor, documentEnvelope, type DocumentReadPermitProvider } from './projectDocumentPorts'

// Preserve the existing native U operation and its internal Codocs candidate
// ACL check; never route this list back through the independent Aims service.
export async function readHostAccessibleProjectDocuments(event: H3Event, provider: DocumentReadPermitProvider, projectId: string) {
  const user = await documentActor(event, 'view')
  const permit = await provider(projectId)
  const { projectId: _parentId, ...authorization } = permit.authorization
  const project = documentEnvelope(await callEnterpriseRuntime<{ code: number, data: Record<string, unknown> }>(event, 'aims.project-view', { tenant: user.tenant, deployment: user.deployment, projectId, authorization, query: permit.query }))
  const object = projectAuthorizationObjectFromFacts(requireAimsProjectAuthorizationRecord(project, projectId), project.members as Record<string, unknown>[], user.uid, projectId)
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'aims', { resourceCode: 'projects', action: 'view', object })
  if (scoped.decision?.allowed !== true) throw createError({ statusCode: 403, message: '无项目文档查看权限' })
  const admin = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'aims', { resourceCode: 'projects', action: 'admin', object })
  await prepareEnterpriseRuntime(event, 'aims.project-document-accessible-list')
  return await callEnterpriseRuntime(event, 'aims.project-document-accessible-list', {
    tenant: user.tenant, deployment: user.deployment, projectId,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'projects', action: 'view', projectId, projectAdmin: admin.decision?.allowed === true, allowed: true, expiresAt: enterpriseRuntimePermitExpiresAt() }
  })
}
