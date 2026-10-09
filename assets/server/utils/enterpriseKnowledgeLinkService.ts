import { createError, type H3Event, setHeader } from 'h3'
import { requireEnterpriseKnowledgeLink } from '@hzy/foundation/server/utils/knowledgeLinkService'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { loadSubjectScopedAuthorizationByService } from '@hzy/foundation/server/utils/subjectScopedAuthorization'
import { assetsObjectScopeFromScopedAuthorization, assetsObjectScopeQuery } from './assetsScopedAuthorizationCore'

export async function handleEnterpriseKnowledgeLink(event: H3Event) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const { envelope, command } = await requireEnterpriseKnowledgeLink(event, 'assets')
  const resolve = async (resourceCode: string, action: 'view' | 'edit', purpose: string) => {
    const snapshot = await loadSubjectScopedAuthorizationByService({ event, subjectUid: command.actorUid, resourceCode, action, purpose })
    const scope = assetsObjectScopeFromScopedAuthorization(snapshot, resourceCode, action, snapshot.departmentCodes, snapshot.departmentTree)
    if (scope.access === 'none') throw createError({ statusCode: 403, message: '无权关联目标资产' })
    return assetsObjectScopeQuery(scope)
  }
  const delivery = await resolve('deliveries', 'edit', 'knowledge_link_deliveries')
  const environment = await resolve('environments', 'view', 'product_adoption_environments')
  const response = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, '/v1/assets/service/enterprise-knowledge-links', { appCode: 'assets', method: 'POST', scope: 'assets:asset-link:create', serviceTokenSourceBinding: 'service-client-policy', serviceCommandActor: { uid: command.actorUid }, body: { serviceCommand: envelope, knowledgeAuthorization: JSON.stringify({ actorUid: command.actorUid, action: 'edit', expiresAt: Date.now() + 15000, delivery, environment }) } })
  if (!response.handled || response.data.code !== 0) throw createError({ statusCode: 503 })
  return { code: 0, data: response.data.data }
}
