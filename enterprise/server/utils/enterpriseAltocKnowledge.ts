import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, requireEnterpriseUser, prepareEnterpriseRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { assetsObjectScopeFromScopedAuthorization, assetsObjectScopeQuery } from '../../../assets/server/utils/assetsScopedAuthorizationCore'
import { resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import { fetchConsoleDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import { buildAltocDepartmentTreeCodeIndex, type AltocDepartmentScopeTreeNode } from '../../../altoc/server/utils/altocDataAccessScope'
import { crossAppForwardedHeaders } from '@hzy/foundation/server/utils/crossAppForwardedHeaders'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { requestWithServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'
import { buildServiceCommandRuntimeHeaders } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { validateServiceCommandReceipt } from '@hzy/foundation/server/utils/serviceOperation'
import { canonicalKnowledgeCommand } from '@hzy/foundation/server/utils/knowledgeLinkContract'
import { buildAPFPermit } from './enterpriseAPF'

export const knowledgeOperations = ['customer-assets-summary', 'customer-documents-page', 'service-ticket-knowledge-link', 'service-ticket-knowledge-resume', 'service-ticket-knowledge-view'] as const
type Operation = typeof knowledgeOperations[number]
type Row = Record<string, unknown>
export async function enterpriseAltocKnowledge(event: H3Event, operation: Operation) {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const user = await requireEnterpriseUser(event)
  const customer = operation.startsWith('customer-')
  const write = operation.endsWith('-link') || operation.endsWith('-resume')
  const id = getRouterParam(event, customer ? 'customerId' : 'ticketId') || ''
  if (!knowledgeOperations.includes(operation) || !/^[1-9]\d{0,15}$/.test(id)) throw createError({ statusCode: 400 })
  const raw = write ? await readBody<Row>(event) : getQuery(event)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (write && Object.keys(getQuery(event)).length)) throw createError({ statusCode: 400 })
  const allowed = customer ? ['page', 'pageSize'] : operation.endsWith('-link') ? ['documentUuid', 'expectedVersion'] : []
  if (Object.keys(raw).some(k => !allowed.includes(k))) throw createError({ statusCode: 400 })
  const payload: Row = customer ? { page: Number(raw.page || 1), pageSize: Number(raw.pageSize || 20) } : { ...raw }
  if (customer && (![payload.page, payload.pageSize].every(n => Number.isSafeInteger(n) && Number(n) >= 1) || Number(payload.pageSize) > 100 || Number(payload.page) > 1000000)) throw createError({ statusCode: 400 })
  if (operation.endsWith('-link') && (!/^[0-9a-f-]{36}$/.test(String(payload.documentUuid)) || !Number.isSafeInteger(payload.expectedVersion) || Number(payload.expectedVersion) < 1)) throw createError({ statusCode: 400 })
  const key = getHeader(event, 'idempotency-key')
  if (write && (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key))) throw createError({ statusCode: 400 })
  const op = `altoc.apf16e-${operation}` as Parameters<typeof callEnterpriseRuntime>[1]
  await prepareEnterpriseRuntime(event, op)
  const authorization = { ...await buildAPFPermit(event, 'altoc', write ? 'save' : 'view', { id, code: '', name: '', rowVersion: 0, page: 0, pageSize: 0, search: '' }, user, customer ? undefined : 'service_ticket', write ? 'edit' : undefined), operation }
  const assetsAuthorization = async () => {
    const resolve = async (resourceCode: string, action: 'view' | 'edit') => {
      const snapshot = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'assets', { resourceCode, action })
      const predicates = snapshot.grants.flatMap(g => [...(g.scopes || []), ...(g.defaultScopes || []), ...(g.assignmentScopes || [])])
      let codes: string[] = []
      let tree: Record<string, string[]> = {}
      if (predicates.some(p => p.dimension === 'department' && p.predicate === 'self' && !p.value)) {
        const response = await fetchConsoleDirectoryApi<{ code: number, data: { departments: { deptCode: string }[] } }>('/user-departments', { event, params: { uid: user.uid } })
        if (response.code !== 0 || !Array.isArray(response.data?.departments)) throw createError({ statusCode: 503 })
        codes = response.data.departments.map(d => d.deptCode)
      }
      if (predicates.some(p => p.dimension === 'department' && p.predicate === 'tree')) {
        const response = await fetchConsoleDirectoryApi<{ code: number, data: { tree: AltocDepartmentScopeTreeNode[] } }>('/departments', { event })
        if (response.code !== 0 || !Array.isArray(response.data?.tree)) throw createError({ statusCode: 503 })
        tree = buildAltocDepartmentTreeCodeIndex(response.data.tree)
      }
      const scope = assetsObjectScopeFromScopedAuthorization(snapshot, resourceCode, action, codes, tree)
      return assetsObjectScopeQuery(scope)
    }
    return JSON.stringify({ actorUid: user.uid, action: write ? 'edit' : 'view', expiresAt: Date.now() + 15000, delivery: await resolve('deliveries', write ? 'edit' : 'view'), environment: await resolve('environments', 'view') })
  }
  if (operation !== 'customer-documents-page') payload.assetsAuthorization = await assetsAuthorization()
  const routes = write ? { assets: resolveTrustedServiceAppRoute(event, 'assets'), codocs: resolveTrustedServiceAppRoute(event, 'codocs') } : null
  if (operation.endsWith('-link')) {
    if (!routes?.assets || !routes.codocs) throw createError({ statusCode: 503, message: '知识关联目标未就绪' })
    payload.assetsDeployment = routes.assets.deploymentCode
    payload.codocsDeployment = routes.codocs.deploymentCode
  }
  const invoke = (payload: Row) => callEnterpriseRuntime<{ code: number, data: Row }>(event, op, { sales: { id, payload }, authorization }, write ? { idempotencyKey: key } : {})
  const result = await invoke(payload)
  if (!write) return result
  // No user-supplied receipt/command can enter this executor. Runtime froze all
  // source facts; each target uses a new Enterprise token and current user ACL.
  const frozen = result.data?.frozen
  if (!Array.isArray(frozen) || frozen.length !== 2 || !routes) throw createError({ statusCode: 503 })
  const receipts: Row[] = []
  for (const envelope of frozen as Row[]) {
    // MySQL JSON key order is not a wire contract; match Go encoding/json.
    envelope.command = canonicalKnowledgeCommand(envelope.command as Row)
    const target = envelope.targetApp
    if (target !== 'assets' && target !== 'codocs') throw createError({ statusCode: 503 })
    const command = envelope.command as Row
    const route = routes[target]
    const capability = target === 'assets' ? 'assets:asset-link:create' : 'codocs:knowledge-link:create'
    if (!route || command.actorUid !== user.uid || command.targetDeployment !== route.deploymentCode || envelope.requiredCapability !== capability || envelope.operationCode !== `enterprise.${target}.knowledge-link.v1`) throw createError({ statusCode: 409, message: '冻结目标发生变化，不能恢复投递' })
    const url = `${route.baseUrl.replace(/\/$/, '')}/api/v1/service/enterprise-knowledge-links`
    const requestId = crypto.randomUUID()
    const response = await requestWithServiceAccessToken({ event, audience: target, scope: capability, async request(token) {
      const headers = await buildServiceCommandRuntimeHeaders({ token, method: 'POST', requestTarget: new URL(url).pathname, requestId, tenantCode: user.tenant, sourceDeploymentCode: user.deployment, targetDeploymentCode: route.deploymentCode, sourceApp: 'enterprise', sourceClientId: 'enterprise.runtime', targetApp: target, envelope: envelope as never })
      return serviceAppFetch<{ code: number, data: Row }>(event, target, url, { method: 'POST', headers: { ...crossAppForwardedHeaders(event), ...headers, 'authorization': `Bearer ${token}`, 'x-request-id': requestId, 'idempotency-key': String(envelope.idempotencyKey) }, body: { serviceCommand: envelope }, timeout: 10000 })
    } })
    if (response.code !== 0) throw createError({ statusCode: 503 })
    validateServiceCommandReceipt(envelope as never, response.data, { targetBizType: target === 'assets' ? 'delivery_document' : 'document', targetBizCode: String(command.documentUuid) })
    receipts.push(response.data)
  }
  const resumeOp = 'altoc.apf16e-service-ticket-knowledge-resume' as Parameters<typeof callEnterpriseRuntime>[1]
  const checkpointAuthorization = { ...await buildAPFPermit(event, 'altoc', 'save', { id, code: '', name: '', rowVersion: 0, page: 0, pageSize: 0, search: '' }, user, 'service_ticket', 'edit'), operation: 'service-ticket-knowledge-resume' }
  // Recompute short-lived target scopes on a long request before checkpoint.
  const completed = await callEnterpriseRuntime<{ code: number, data: Row }>(event, resumeOp, { sales: { id, payload: { assetsAuthorization: await assetsAuthorization(), checkpoint: JSON.stringify(receipts) } }, authorization: checkpointAuthorization }, { idempotencyKey: key })
  return { code: completed.code, data: { id: completed.data.id, status: 'linked' } }
}
