import { authorizationActionsAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createError, getHeader, getQuery, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { loadSubjectScopedAuthorizationByService } from '@hzy/foundation/server/utils/subjectScopedAuthorization'
import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireServiceScope } from './serviceAuth'
import { listAccessibleProjectDocuments } from './accessibleProjectDocuments'

type Row = Record<string, unknown>
const id = /^[1-9]\d*$/
// 与项目文档元数据读取同一授权面：都是按操作者本人的 Codocs ACL 列出可见文档。
const capability = 'aims:project-documents:read'

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function handleEnterpriseAccessibleProjectDocumentsService(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'POST' || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '可访问文档代理请求无效' })
  const auth = await requireConsoleAuthContext(event)
  requireServiceScope(event, { scope: capability, allowedApps: ['enterprise'] })
  const gateway = resolveTrustedTenantGatewayContext(event)
  if (auth.appCode !== 'enterprise' || auth.clientCode !== 'enterprise.runtime' || !auth.tenant || !auth.deployment || !gateway || gateway.tenant !== auth.tenant || gateway.appCode !== 'aims' || !gateway.deployment) throw createError({ statusCode: 403, message: '可访问文档代理来源或部署绑定无效' })
  const body = await readBody(event)
  const envelope = body?.serviceCommand
  const command = envelope?.command as Row | undefined
  const actorUid = text(command?.actorUid)
  const projectId = text(command?.projectId)
  if (
    !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
    || !envelope || !command
    || Object.keys(command).some(key => !['actorUid', 'tenant', 'sourceDeployment', 'targetDeployment', 'action', 'projectId'].includes(key))
    || text(command.action) !== 'list'
    || !actorUid || !id.test(projectId) || !Number.isSafeInteger(Number(projectId))
    || text(command.tenant) !== auth.tenant
    || text(command.sourceDeployment) !== auth.deployment
    || text(command.targetDeployment) !== gateway.deployment
    || envelope.targetApp !== 'aims'
    || envelope.operationCode !== 'enterprise.aims.accessible-project-documents.list.v1'
    || envelope.requiredCapability !== capability
    || envelope.commandSchemaVersion !== 'enterprise-accessible-project-documents.v1'
    || envelope.commandSha256 !== await hashServiceCommandPayload(command)
  ) throw createError({ statusCode: 403, message: '可访问文档代理命令无效' })
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401, message: '缺少服务令牌' })
  await verifyServiceCommandRuntimeHeaders({ event, token, method: 'POST', requestTarget: getRequestURL(event).pathname, requestId: getHeader(event, 'x-request-id') || '', tenantCode: auth.tenant, sourceDeploymentCode: auth.deployment, targetDeploymentCode: gateway.deployment, sourceApp: 'enterprise', sourceClientId: 'enterprise.runtime', targetApp: 'aims', envelope, readHeader: name => getHeader(event, name) })

  const subject = await loadSubjectScopedAuthorizationByService({ event, timeoutMs: 100000, subjectUid: actorUid, purpose: 'enterprise_accessible_project_documents_list', resourceCode: 'projects', action: 'view' })
  if (!subject.grants.some(grant => grant.permissions.some(permission => permission.appCode === 'aims' && permission.resourceCode === 'projects' && authorizationActionsAllow([permission.action], 'view', subject.actionPolicy)))) throw createError({ statusCode: 403, message: '无项目文档查看权限' })

  // 逐份文档的 Codocs ACL 复核在共用函数内部按 actorUid 执行。
  return await listAccessibleProjectDocuments(event, actorUid, projectId)
}
