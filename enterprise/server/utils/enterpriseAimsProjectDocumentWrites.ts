import { createError, getRouterParam, readBody, readMultipartFormData, setHeader, type H3Event } from 'h3'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { resolveServiceAppBaseUrl, resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestWithServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { buildServiceCommandRuntimeHeaders, hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

type Action = 'create-index' | 'create-markdown' | 'upload-file' | 'delete'
// 写入独立于只读：read 不蕴含 write。
const capabilities = Object.freeze({ write: 'aims:project-documents:write' })
const numericID = /^[1-9]\d*$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

async function proxy(event: H3Event, action: Action, keys: Record<string, string>, payload?: Record<string, unknown>) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const capability = capabilities.write
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(authorization.resources, 'projects', 'view', authorization.actionPolicies?.projects)) throw createError({ statusCode: 403, message: '无项目文档编辑权限' })
  const gateway = resolveTrustedTenantGatewayContext(event)
  const route = resolveTrustedServiceAppRoute(event, 'aims')
  const base = resolveServiceAppBaseUrl(event, 'aims')
  if (!gateway || gateway.appCode !== 'enterprise' || gateway.tenant !== user.tenant || gateway.deployment !== user.deployment || !route || !base || !route.deploymentCode) throw createError({ statusCode: 503, message: 'Aims 项目文档写入代理部署绑定不可用' })
  const command = { actorUid: user.uid, tenant: user.tenant, sourceDeployment: user.deployment, targetDeployment: route.deploymentCode, action, ...keys, ...(payload ? { payload } : {}) }
  const commandSha256 = await hashServiceCommandPayload(command)
  // 幂等键由稳定业务键派生（新建取文档 uuid，删除取文档 id），不是随机值，
  // 因此同一次用户操作的重试在目标端是同一个键。
  const businessKey = keys.documentUuid || keys.documentId
  const serviceCommand = {
    operationId: crypto.randomUUID(),
    targetApp: 'aims',
    operationCode: `enterprise.aims.project-document-writes.${action}.v1`,
    requiredCapability: capability,
    idempotencyKey: `enterprise:aims:project-document-writes:${action}:${businessKey}`,
    commandSchemaVersion: 'enterprise-project-document-writes.v1',
    commandSha256,
    command
  }
  const url = `${base.replace(/\/+$/, '')}/api/v1/service/enterprise/project-document-writes/execute`
  return await requestWithServiceAccessToken({ audience: 'aims', scope: capability, event, async request(token) {
    const requestId = crypto.randomUUID()
    const signed = await buildServiceCommandRuntimeHeaders({ token, method: 'POST', requestTarget: new URL(url, 'http://localhost').pathname, requestId, tenantCode: user.tenant, sourceDeploymentCode: user.deployment, targetDeploymentCode: route.deploymentCode, sourceApp: 'enterprise', sourceClientId: 'enterprise.runtime', targetApp: 'aims', envelope: serviceCommand })
    return await serviceAppFetch(event, 'aims', url, { method: 'POST', body: { serviceCommand }, timeout: 240000, headers: { ...trustedServiceRequestHeaders(event, 'aims'), 'authorization': `Bearer ${token}`, 'x-request-id': requestId, 'idempotency-key': serviceCommand.idempotencyKey, 'x-hzy-tenant': user.tenant, 'x-hzy-deployment': route.deploymentCode, 'x-hzy-app-code': 'aims', ...signed } })
  } })
}

export async function enterpriseAimsCreateProjectDocument(event: H3Event) {
  const body = await readBody<Record<string, unknown>>(event) || {}
  // 浏览器必须自带文档 uuid：它同时是业务主键和幂等键，服务端不代生成，
  // 否则同一次创建的重试会各得一个新 uuid 并落成重复文档。
  const documentUuid = text(body.uuid)
  if (!uuidPattern.test(documentUuid)) throw createError({ statusCode: 400, message: '缺少有效的文档 uuid' })
  const { uuid: _uuid, ...rest } = body
  return await proxy(event, 'create-index', { documentUuid }, rest)
}

export async function enterpriseAimsCreateProjectMarkdownDocument(event: H3Event) {
  const projectId = text(getRouterParam(event, 'id'))
  if (!numericID.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: '项目标识无效' })
  const body = await readBody<Record<string, unknown>>(event) || {}
  // Markdown 文档的 uuid 由 Aims 生成，这里用调用方提供的幂等键锚定重试；
  // 没有就用请求体派生一个稳定键，保证同一份内容的重试不会建出两篇。
  const documentUuid = text(body.idempotencyUuid) || text(body.uuid)
  const { idempotencyUuid: _key, ...rest } = body
  const anchor = uuidPattern.test(documentUuid) ? documentUuid : await stableUuid(projectId, rest)
  return await proxy(event, 'create-markdown', { documentUuid: anchor, projectId }, rest)
}

export async function enterpriseAimsDeleteProjectDocument(event: H3Event) {
  const documentId = text(getRouterParam(event, 'id'))
  if (!numericID.test(documentId) || !Number.isSafeInteger(Number(documentId))) throw createError({ statusCode: 400, message: '文档标识无效' })
  return await proxy(event, 'delete', { documentId })
}

export async function enterpriseAimsUploadProjectDocument(event: H3Event) {
  await requireEnterpriseUser(event)
  const projectId = text(getRouterParam(event, 'id'))
  if (!numericID.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: '项目标识无效' })
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'file' && part.filename)
  const documentUuid = parts?.find(part => part.name === 'documentUuid')?.data.toString() || ''
  if (!uuidPattern.test(documentUuid)) throw createError({ statusCode: 400, message: '缺少有效的文档 uuid' })
  if (!file?.filename || !file.data.length || file.data.length > 10 * 1024 * 1024) throw createError({ statusCode: 400, message: '请选择不超过 10MB 的文件' })
  return await proxy(event, 'upload-file', { projectId, documentUuid }, {
    fileName: file.filename, contentType: file.type || 'application/octet-stream',
    contentBase64: file.data.toString('base64'),
    docCategory: parts?.find(part => part.name === 'docCategory')?.data.toString() || ''
  })
}

// 由项目与请求体内容派生的确定性 UUID：同一份提交重试得到同一个键。
async function stableUuid(projectId: string, body: Record<string, unknown>) {
  const digest = await hashServiceCommandPayload({ projectId, body })
  const hex = digest.replace(/[^0-9a-f]/gi, '').slice(0, 32).padEnd(32, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
