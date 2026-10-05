import { authorizationActionsAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createError, getHeader, getQuery, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { loadSubjectScopedAuthorizationByService } from '@hzy/foundation/server/utils/subjectScopedAuthorization'
import { hashServiceCommandPayload, maybeCallTenantRuntime, verifyServiceCommandRuntimeHeaders } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireServiceScope } from './serviceAuth'
import { getCodocsProjectDocumentContent } from './codocsApi'
import { runtimeEnvelopeError } from './aimsRuntimeForward'

type Row = Record<string, unknown>
const capability = 'aims:project-documents:read'
const id = /^[1-9]\d*$/
const actions = new Set(['list', 'view', 'open'])
const scopeKey = /^current_user_(?:is_project_admin|dept_codes|management_dept_codes|project_admin_(?:dept_codes|member_scope|owner_scope|project_codes|member_project_codes|owner_project_codes))$/

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}
function unwrap<T>(response: { code?: number, data?: T, message?: string }) {
  if (response.code !== 0 || response.data === undefined) throw runtimeEnvelopeError(response)
  return response.data
}

export async function handleEnterpriseProjectDocumentsService(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'POST' || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '项目文档代理请求无效' })
  const auth = await requireConsoleAuthContext(event)
  requireServiceScope(event, { scope: capability, allowedApps: ['enterprise'] })
  const gateway = resolveTrustedTenantGatewayContext(event)
  if (auth.appCode !== 'enterprise' || auth.clientCode !== 'enterprise.runtime' || !auth.tenant || !auth.deployment || !gateway || gateway.tenant !== auth.tenant || gateway.appCode !== 'aims' || !gateway.deployment) throw createError({ statusCode: 403, message: '项目文档代理来源或部署绑定无效' })
  const body = await readBody(event)
  const envelope = body?.serviceCommand
  const command = envelope?.command as Row | undefined
  const action = text(command?.action)
  const actorUid = text(command?.actorUid)
  const projectId = text(command?.projectId)
  const documentId = text(command?.documentId)
  const scope = command?.scope
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !envelope || !command || Object.keys(command).some(key => !['actorUid', 'tenant', 'sourceDeployment', 'targetDeployment', 'projectId', 'documentId', 'action', 'query', 'scope'].includes(key)) || !actions.has(action) || !actorUid || !id.test(projectId) || (action !== 'list' && !id.test(documentId)) || text(command.tenant) !== auth.tenant || text(command.sourceDeployment) !== auth.deployment || text(command.targetDeployment) !== gateway.deployment || !scope || typeof scope !== 'object' || Array.isArray(scope) || Object.entries(scope).some(([key, value]) => !scopeKey.test(key) || typeof value !== 'string' || !value || value.length > 1000) || envelope.targetApp !== 'aims' || envelope.operationCode !== `enterprise.aims.project-documents.${action}.v1` || envelope.requiredCapability !== capability || envelope.commandSchemaVersion !== 'enterprise-project-documents.v1' || envelope.commandSha256 !== await hashServiceCommandPayload(command)) throw createError({ statusCode: 403, message: '项目文档代理命令无效' })
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401, message: '缺少服务令牌' })
  await verifyServiceCommandRuntimeHeaders({ event, token, method: 'POST', requestTarget: getRequestURL(event).pathname, requestId: getHeader(event, 'x-request-id') || '', tenantCode: auth.tenant, sourceDeploymentCode: auth.deployment, targetDeploymentCode: gateway.deployment, sourceApp: 'enterprise', sourceClientId: 'enterprise.runtime', targetApp: 'aims', envelope, readHeader: name => getHeader(event, name) })
  const subject = await loadSubjectScopedAuthorizationByService({ event, timeoutMs: 100000, subjectUid: actorUid, purpose: 'enterprise_project_document_read', resourceCode: 'projects', action: 'view' })
  if (!subject.grants.some(grant => grant.permissions.some(permission => permission.appCode === 'aims' && permission.resourceCode === 'projects' && authorizationActionsAllow([permission.action], 'view', subject.actionPolicy)))) throw createError({ statusCode: 403, message: '无项目文档查看权限' })
  const query = { current_user: actorUid, operator_uid: actorUid, ...(scope as Record<string, string>) }
  const filters = command.query
  if (action === 'list' && filters && (typeof filters !== 'object' || Array.isArray(filters) || Object.entries(filters).some(([key, value]) => key !== 'docCategory' || typeof value !== 'string' || !value || value.length > 100))) throw createError({ statusCode: 400, message: '项目文档筛选参数无效' })
  if (action === 'list' && filters && typeof filters === 'object') Object.assign(query, filters)
  const path = action === 'list' ? `/v1/aims/projects/${projectId}/documents` : `/v1/aims/projects/${projectId}/documents/${documentId}`
  const runtime = await maybeCallTenantRuntime<{ code: number, data: Row }>(event, path, { appCode: 'aims', method: 'GET', scope: `aims.read ${capability}`, serviceTokenSourceBinding: 'service-client-policy', serviceCommandActor: { uid: actorUid }, query })
  if (!runtime.handled) throw createError({ statusCode: 503, message: 'Aims 项目文档运行服务暂不可用' })
  const data = unwrap(runtime.data)
  if (action !== 'open') return { code: 0, data }
  const project = await maybeCallTenantRuntime<{ code: number, data: Row }>(event, `/v1/aims/projects/${projectId}`, { appCode: 'aims', method: 'GET', scope: `aims.read ${capability}`, serviceTokenSourceBinding: 'service-client-policy', serviceCommandActor: { uid: actorUid }, query })
  if (!project.handled) throw createError({ statusCode: 503, message: 'Aims 项目事实暂不可用' })
  const projectCode = text(unwrap(project.data).projectCode ?? unwrap(project.data).project_code)
  const documentUuid = text(data.codocsUuid ?? data.codocs_uuid)
  if (text(data.documentSource ?? data.document_source) !== 'codocs' || !projectCode || !documentUuid) throw createError({ statusCode: 409, message: '当前文档没有可验证的 Codocs 内容绑定' })
  const content = await getCodocsProjectDocumentContent({ event, actorUid, projectCode, documentUuid })
  return { code: 0, data: { document: data, content: content.data } }
}
