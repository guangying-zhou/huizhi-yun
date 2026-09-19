import { createError, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { resolveServiceAppBaseUrl, resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestWithServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { buildServiceCommandRuntimeHeaders, hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

type Action = 'policy-read' | 'check' | 'audit' | 'policy-update'
// 改策略的门槛是项目经理，不是能编辑文档，因此访问策略单列资源；read 不蕴含 manage。
const capabilities = Object.freeze({ read: 'aims:project-document-access:read', manage: 'aims:project-document-access:manage' })
const numericID = /^[1-9]\d*$/

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function ids(event: H3Event) {
  const projectId = text(getRouterParam(event, 'id'))
  const documentId = text(getRouterParam(event, 'documentId'))
  if (!numericID.test(projectId) || !Number.isSafeInteger(Number(projectId)) || !numericID.test(documentId) || !Number.isSafeInteger(Number(documentId))) {
    throw createError({ statusCode: 400, message: '项目或文档标识无效' })
  }
  return { projectId, documentId }
}

async function proxy(event: H3Event, action: Action, payload?: Record<string, unknown>) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const manage = action === 'policy-update'
  const capability = manage ? capabilities.manage : capabilities.read
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  const needed = 'view'
  if (!authorizationResourcesAllow(authorization.resources, 'projects', needed, authorization.actionPolicies?.projects)) throw createError({ statusCode: 403, message: '无项目文档访问策略权限' })
  const gateway = resolveTrustedTenantGatewayContext(event)
  const route = resolveTrustedServiceAppRoute(event, 'aims')
  const base = resolveServiceAppBaseUrl(event, 'aims')
  if (!gateway || gateway.appCode !== 'enterprise' || gateway.tenant !== user.tenant || gateway.deployment !== user.deployment || !route || !base || !route.deploymentCode) throw createError({ statusCode: 503, message: 'Aims 项目文档访问策略代理部署绑定不可用' })
  const { projectId, documentId } = ids(event)
  const command = { actorUid: user.uid, tenant: user.tenant, sourceDeployment: user.deployment, targetDeployment: route.deploymentCode, action, projectId, documentId, ...(payload ? { payload } : {}) }
  const commandSha256 = await hashServiceCommandPayload(command)
  const serviceCommand = {
    operationId: crypto.randomUUID(),
    targetApp: 'aims',
    operationCode: `enterprise.aims.project-document-access.${action}.v1`,
    requiredCapability: capability,
    // 改策略是覆盖写：幂等键锚定到目标文档，重放同一份策略得到同一结果。
    idempotencyKey: `enterprise:aims:project-document-access:${action}:${documentId}:${commandSha256.slice(0, 16)}`,
    commandSchemaVersion: 'enterprise-project-document-access.v1',
    commandSha256,
    command
  }
  const url = `${base.replace(/\/+$/, '')}/api/v1/service/enterprise/project-document-access/execute`
  return await requestWithServiceAccessToken({ audience: 'aims', scope: capability, event, async request(token) {
    const requestId = crypto.randomUUID()
    const signed = await buildServiceCommandRuntimeHeaders({ token, method: 'POST', requestTarget: new URL(url, 'http://localhost').pathname, requestId, tenantCode: user.tenant, sourceDeploymentCode: user.deployment, targetDeploymentCode: route.deploymentCode, sourceApp: 'enterprise', sourceClientId: 'enterprise.runtime', targetApp: 'aims', envelope: serviceCommand })
    const headers: Record<string, string> = { ...trustedServiceRequestHeaders(event, 'aims'), 'authorization': `Bearer ${token}`, 'x-request-id': requestId, 'x-hzy-tenant': user.tenant, 'x-hzy-deployment': route.deploymentCode, 'x-hzy-app-code': 'aims', ...signed }
    if (manage) headers['idempotency-key'] = serviceCommand.idempotencyKey
    return await serviceAppFetch(event, 'aims', url, { method: 'POST', body: { serviceCommand }, timeout: 240000, headers })
  } })
}

export function enterpriseAimsReadDocumentAccessPolicy(event: H3Event) {
  return proxy(event, 'policy-read')
}

export async function enterpriseAimsCheckDocumentAccess(event: H3Event) {
  const body = await readBody<{ action?: unknown }>(event) || {}
  return await proxy(event, 'check', { action: text(body.action) || 'view' })
}

export function enterpriseAimsListDocumentAccessAudit(event: H3Event) {
  const query = getQuery(event)
  return proxy(event, 'audit', { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20 })
}

export async function enterpriseAimsUpdateDocumentAccessPolicy(event: H3Event) {
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, message: '缺少访问策略请求体' })
  return await proxy(event, 'policy-update', body)
}
