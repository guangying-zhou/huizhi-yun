import { createError, getQuery, setHeader, type H3Event } from 'h3'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { resolveServiceAppBaseUrl, resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestWithServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { buildServiceCommandRuntimeHeaders, hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

// 与项目文档元数据读取同一授权面，不额外新增能力。
const capabilities = Object.freeze({ list: 'aims:project-documents:read' })
const numericID = /^[1-9]\d*$/

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function enterpriseAimsAccessibleProjectDocuments(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const capability = capabilities.list
  const query = getQuery(event)
  const projectId = text(query.projectId ?? query.project_id)
  if (!numericID.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: '请选择项目' })
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(authorization.resources, 'projects', 'view', authorization.actionPolicies?.projects)) throw createError({ statusCode: 403, message: '无项目文档查看权限' })
  const gateway = resolveTrustedTenantGatewayContext(event)
  const route = resolveTrustedServiceAppRoute(event, 'aims')
  const base = resolveServiceAppBaseUrl(event, 'aims')
  if (!gateway || gateway.appCode !== 'enterprise' || gateway.tenant !== user.tenant || gateway.deployment !== user.deployment || !route || !base || !route.deploymentCode) throw createError({ statusCode: 503, message: 'Aims 可访问文档代理部署绑定不可用' })
  const command = { actorUid: user.uid, tenant: user.tenant, sourceDeployment: user.deployment, targetDeployment: route.deploymentCode, action: 'list', projectId }
  const commandSha256 = await hashServiceCommandPayload(command)
  const serviceCommand = { operationId: crypto.randomUUID(), targetApp: 'aims', operationCode: 'enterprise.aims.accessible-project-documents.list.v1', requiredCapability: capability, idempotencyKey: `enterprise:aims:accessible-project-documents:${commandSha256.slice(0, 32)}`, commandSchemaVersion: 'enterprise-accessible-project-documents.v1', commandSha256, command }
  const url = `${base.replace(/\/+$/, '')}/api/v1/service/enterprise/accessible-project-documents/read`
  return await requestWithServiceAccessToken({ audience: 'aims', scope: capability, event, async request(token) {
    const requestId = crypto.randomUUID()
    const signed = await buildServiceCommandRuntimeHeaders({ token, method: 'POST', requestTarget: new URL(url, 'http://localhost').pathname, requestId, tenantCode: user.tenant, sourceDeploymentCode: user.deployment, targetDeploymentCode: route.deploymentCode, sourceApp: 'enterprise', sourceClientId: 'enterprise.runtime', targetApp: 'aims', envelope: serviceCommand })
    return await serviceAppFetch(event, 'aims', url, { method: 'POST', body: { serviceCommand }, timeout: 240000, headers: { ...trustedServiceRequestHeaders(event, 'aims'), 'authorization': `Bearer ${token}`, 'x-request-id': requestId, 'x-hzy-tenant': user.tenant, 'x-hzy-deployment': route.deploymentCode, 'x-hzy-app-code': 'aims', ...signed } })
  } })
}
