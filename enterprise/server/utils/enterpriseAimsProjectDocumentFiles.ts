import { createError, getRouterParam, sendRedirect, setHeader, type H3Event } from 'h3'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { resolveServiceAppBaseUrl, resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestWithServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { buildServiceCommandRuntimeHeaders, hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

type Action = 'preview' | 'download'
// 下载是导出性质的敏感动作，按根 CLAUDE.md 单独声明 capability，不由 :read 蕴含。
const capabilities = Object.freeze({ preview: 'aims:project-documents:read', download: 'aims:project-documents:download' })
const numericID = /^[1-9]\d*$/
function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

async function proxy(event: H3Event, action: Action) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const projectId = text(getRouterParam(event, 'id'))
  const documentId = text(getRouterParam(event, 'documentId'))
  if (!numericID.test(projectId) || !Number.isSafeInteger(Number(projectId)) || !numericID.test(documentId) || !Number.isSafeInteger(Number(documentId))) throw createError({ statusCode: 400, message: '项目或文档标识无效' })
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(authorization.resources, 'projects', 'view', authorization.actionPolicies?.projects)) throw createError({ statusCode: 403, message: '无项目文档查看权限' })
  const gateway = resolveTrustedTenantGatewayContext(event)
  const route = resolveTrustedServiceAppRoute(event, 'aims')
  const base = resolveServiceAppBaseUrl(event, 'aims')
  if (!gateway || gateway.appCode !== 'enterprise' || gateway.tenant !== user.tenant || gateway.deployment !== user.deployment || !route || !base || !route.deploymentCode) throw createError({ statusCode: 503, message: 'Aims 项目文档文件代理部署绑定不可用' })
  const capability = capabilities[action]
  const command = { actorUid: user.uid, tenant: user.tenant, sourceDeployment: user.deployment, targetDeployment: route.deploymentCode, projectId, documentId, action }
  const commandSha256 = await hashServiceCommandPayload(command)
  const serviceCommand = { operationId: crypto.randomUUID(), targetApp: 'aims', operationCode: `enterprise.aims.project-document-files.${action}.v1`, requiredCapability: capability, idempotencyKey: `enterprise:aims:project-document-files:${commandSha256.slice(0, 32)}`, commandSchemaVersion: 'enterprise-project-document-files.v1', commandSha256, command }
  const url = `${base.replace(/\/+$/, '')}/api/v1/service/enterprise/project-document-files/read`
  return await requestWithServiceAccessToken({ audience: 'aims', scope: capability, event, async request(token) {
    const requestId = crypto.randomUUID()
    const signed = await buildServiceCommandRuntimeHeaders({ token, method: 'POST', requestTarget: new URL(url, 'http://localhost').pathname, requestId, tenantCode: user.tenant, sourceDeploymentCode: user.deployment, targetDeploymentCode: route.deploymentCode, sourceApp: 'enterprise', sourceClientId: 'enterprise.runtime', targetApp: 'aims', envelope: serviceCommand })
    return await serviceAppFetch(event, 'aims', url, { method: 'POST', body: { serviceCommand }, timeout: 240000, headers: { ...trustedServiceRequestHeaders(event, 'aims'), 'authorization': `Bearer ${token}`, 'x-request-id': requestId, 'x-hzy-tenant': user.tenant, 'x-hzy-deployment': route.deploymentCode, 'x-hzy-app-code': 'aims', ...signed } })
  } })
}

export const enterpriseAimsProjectDocumentPreview = (event: H3Event) => proxy(event, 'preview')

export async function enterpriseAimsProjectDocumentDownload(event: H3Event) {
  const response = await proxy(event, 'download') as { code?: number, data?: { url?: unknown } }
  const url = text(response?.data?.url)
  // 与独立 Aims 一致：只 302 到 Codocs 签发的短期地址，宿主不代理文件字节。
  // 地址必须是 https 绝对地址，避免把相对路径当成宿主自身的开放重定向。
  if (response?.code !== 0 || !/^https:\/\//i.test(url)) throw createError({ statusCode: 502, message: '项目文档下载地址不可用' })
  return sendRedirect(event, url, 302)
}
