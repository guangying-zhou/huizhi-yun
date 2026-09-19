import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import { serviceAppFetch } from '@hzy/foundation/server/utils/appServiceBinding'
import { resolveServiceAppBaseUrl, resolveTrustedServiceAppRoute } from '@hzy/foundation/server/utils/serviceAppUrl'
import { requestWithServiceAccessToken, trustedServiceRequestHeaders } from '@hzy/foundation/server/utils/serviceOidc'
import { buildServiceCommandRuntimeHeaders, hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'

type Action = 'dept-documents' | 'project-documents' | 'repo-tree' | 'repo-doc'
// 四个动作都是候选来源的只读查询，服务端按操作者本人的部门／项目／仓库访问权
// 重新判定，因此共用一个 capability。
const capabilities = Object.freeze({ 'project-document-sources': 'aims:project-document-sources:read' })
const numericID = /^[1-9]\d*$/
const code = /^[A-Za-z0-9._-]{1,120}$/
const ref = /^[A-Za-z0-9._/-]{1,200}$/
function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function queryText(event: H3Event, keys: string[]) {
  const query = getQuery(event)
  for (const key of keys) {
    const raw = query[key]
    if (Array.isArray(raw)) throw createError({ statusCode: 400, message: '项目文档来源参数无效' })
    const value = text(raw)
    if (value) return value
  }
  return ''
}

async function proxy(event: H3Event, action: Action, command: Record<string, string>) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const capability = capabilities['project-document-sources']
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(authorization.resources, 'projects', 'view', authorization.actionPolicies?.projects)) throw createError({ statusCode: 403, message: '无项目文档查看权限' })
  const gateway = resolveTrustedTenantGatewayContext(event)
  const route = resolveTrustedServiceAppRoute(event, 'aims')
  const base = resolveServiceAppBaseUrl(event, 'aims')
  if (!gateway || gateway.appCode !== 'enterprise' || gateway.tenant !== user.tenant || gateway.deployment !== user.deployment || !route || !base || !route.deploymentCode) throw createError({ statusCode: 503, message: 'Aims 项目文档来源代理部署绑定不可用' })
  const payload = { actorUid: user.uid, tenant: user.tenant, sourceDeployment: user.deployment, targetDeployment: route.deploymentCode, action, ...command }
  const commandSha256 = await hashServiceCommandPayload(payload)
  const serviceCommand = { operationId: crypto.randomUUID(), targetApp: 'aims', operationCode: `enterprise.aims.project-document-sources.${action}.v1`, requiredCapability: capability, idempotencyKey: `enterprise:aims:project-document-sources:${commandSha256.slice(0, 32)}`, commandSchemaVersion: 'enterprise-project-document-sources.v1', commandSha256, command: payload }
  const url = `${base.replace(/\/+$/, '')}/api/v1/service/enterprise/project-document-sources/read`
  return await requestWithServiceAccessToken({ audience: 'aims', scope: capability, event, async request(token) {
    const requestId = crypto.randomUUID()
    const signed = await buildServiceCommandRuntimeHeaders({ token, method: 'POST', requestTarget: new URL(url, 'http://localhost').pathname, requestId, tenantCode: user.tenant, sourceDeploymentCode: user.deployment, targetDeploymentCode: route.deploymentCode, sourceApp: 'enterprise', sourceClientId: 'enterprise.runtime', targetApp: 'aims', envelope: serviceCommand })
    return await serviceAppFetch(event, 'aims', url, { method: 'POST', body: { serviceCommand }, timeout: 240000, headers: { ...trustedServiceRequestHeaders(event, 'aims'), 'authorization': `Bearer ${token}`, 'x-request-id': requestId, 'x-hzy-tenant': user.tenant, 'x-hzy-deployment': route.deploymentCode, 'x-hzy-app-code': 'aims', ...signed } })
  } })
}

function requireProjectId(event: H3Event) {
  const projectId = queryText(event, ['aimsProjectId', 'aims_project_id'])
  if (!numericID.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: 'aimsProjectId 无效' })
  return projectId
}

function repoCode(event: H3Event) {
  const value = text(getRouterParam(event, 'projectCode', { decode: true }))
  if (!code.test(value)) throw createError({ statusCode: 400, message: '仓库标识无效' })
  return value
}

function gitRef(event: H3Event): Record<string, string> {
  const value = queryText(event, ['ref'])
  if (value && !ref.test(value)) throw createError({ statusCode: 400, message: 'ref 无效' })
  return value ? { ref: value } : {}
}

export function enterpriseAimsDepartmentDocuments(event: H3Event) {
  const deptCode = queryText(event, ['deptCode', 'dept_code'])
  if (!code.test(deptCode)) throw createError({ statusCode: 400, message: 'deptCode 不能为空' })
  return proxy(event, 'dept-documents', { deptCode })
}

export function enterpriseAimsPortfolioDocuments(event: H3Event) {
  return proxy(event, 'project-documents', { projectId: requireProjectId(event) })
}

export function enterpriseAimsRepoDocsTree(event: H3Event) {
  return proxy(event, 'repo-tree', { projectId: requireProjectId(event), repoProjectCode: repoCode(event), ...gitRef(event) })
}

export function enterpriseAimsRepoDoc(event: H3Event) {
  const path = queryText(event, ['path'])
  if (!path || path.length > 400) throw createError({ statusCode: 400, message: 'path 无效' })
  const commitId = queryText(event, ['commit_id', 'commitId'])
  if (commitId && !code.test(commitId)) throw createError({ statusCode: 400, message: 'commit_id 无效' })
  const command: Record<string, string> = { projectId: requireProjectId(event), repoProjectCode: repoCode(event), path, ...gitRef(event) }
  if (commitId) command.commitId = commitId
  return proxy(event, 'repo-doc', command)
}
