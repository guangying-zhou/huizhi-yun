import { owningCreateError as createError, type OwningH3Event as H3Event } from '@hzy/foundation/server/utils/owningModuleHttp'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

export interface ProjectDocumentReadInput {
  projectId: string
  documentId?: string
  query?: { docCategory?: string }
  projectReadAuthorization: Record<string, unknown>
  projectScopeQuery?: Record<string, string>
}

/** Owning read core. The user is reloaded from the verified Host session; callers
 * cannot select an actor, audience, service scope or Runtime URL. Runtime checks
 * this parent-bound scoped permit before fetching any document rows. */
export async function readHostProjectDocuments(event: H3Event, input: ProjectDocumentReadInput) {
  const id = (value: string) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
  if (!id(input.projectId) || (input.documentId !== undefined && !id(input.documentId))) throw createError({ statusCode: 400, message: '项目或文档标识无效' })
  const query = input.query || {}
  if (Object.entries(query).some(([key, value]) => key !== 'docCategory' || typeof value !== 'string' || !value.trim() || value.length > 100) || (input.documentId !== undefined && Object.keys(query).length)) throw createError({ statusCode: 400, message: '项目文档筛选参数无效' })
  const user = await requireEnterpriseUser(event)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'projects', 'view', snapshot.actionPolicies?.projects)) throw createError({ statusCode: 403, message: '无项目文档查看权限' })
  const operation = input.documentId === undefined ? 'aims.project-document-list' : 'aims.project-document-view'
  await prepareEnterpriseRuntime(event, operation)
  return await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant, deployment: user.deployment, projectId: input.projectId,
    ...(input.documentId !== undefined ? { documentId: input.documentId } : {}), query,
    projectReadAuthorization: input.projectReadAuthorization,
    projectScopeQuery: input.projectScopeQuery || {},
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
      resource: 'projects', action: 'view', expiresAt: enterpriseRuntimePermitExpiresAt() }
  })
}
