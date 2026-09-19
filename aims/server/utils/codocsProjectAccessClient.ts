import { createError, type H3Event } from 'h3'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { resolveServiceAppBaseUrl, resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestWithServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { buildServiceCommandRuntimeHeaders, hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { getRequestUid } from './authIdentity'

export async function callCodocsProjectAccess<T>(event: H3Event | undefined, action: string, payload: Record<string, unknown>) {
  if (!event) throw createError({ statusCode: 503, message: '文档服务缺少请求上下文' })
  const gateway = resolveTrustedTenantGatewayContext(event)
  const route = resolveTrustedServiceAppRoute(event, 'codocs')
  const base = resolveServiceAppBaseUrl(event, 'codocs')
  const actorUid = String(payload.actorUid || payload.operatorUid || getRequestUid(event) || '').trim()
  if (!actorUid || !gateway || gateway.appCode !== 'aims' || !route || !base) throw createError({ statusCode: 503, message: '文档服务身份或部署绑定不可用' })
  const capability = action === 'create' ? 'codocs:project-document-access:create' : action === 'policy-update' ? 'codocs:project-document-access:manage' : 'codocs:project-document-access:read'
  const command = { ...payload, actorUid, action }
  const commandSha256 = await hashServiceCommandPayload(command)
  const serviceCommand = {
    operationId: crypto.randomUUID(), targetApp: 'codocs',
    operationCode: `aims.codocs.project-document-access.${action}.v1`,
    requiredCapability: capability, idempotencyKey: `project-document-access:${commandSha256}`,
    commandSchemaVersion: 'aims-project-document-access.v1', commandSha256, command
  }
  const url = `${base.replace(/\/+$/, '')}/api/v1/service/project-document-access/execute`
  return await requestWithServiceAccessToken<T>({ event, audience: 'codocs', scope: capability, async request(token) {
    const requestId = crypto.randomUUID()
    const signed = await buildServiceCommandRuntimeHeaders({ token, method: 'POST', requestTarget: new URL(url).pathname, requestId, tenantCode: gateway.tenant, sourceDeploymentCode: gateway.deployment, targetDeploymentCode: route.deploymentCode, sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'codocs', envelope: serviceCommand })
    return await serviceAppFetch<T>(event, 'codocs', url, { method: 'POST', body: { serviceCommand }, headers: { ...trustedServiceRequestHeaders(event, 'codocs'), 'authorization': `Bearer ${token}`, 'x-request-id': requestId, 'idempotency-key': serviceCommand.idempotencyKey, ...signed } })
  } })
}
