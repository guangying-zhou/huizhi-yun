import { authorizationActionsAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createError, getHeader, getQuery, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { loadSubjectScopedAuthorizationByService } from '@hzy/foundation/server/utils/subjectScopedAuthorization'
import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireServiceScope } from './serviceAuth'
import {
  checkProjectDocumentAccess,
  listProjectDocumentAccessAudit,
  normalizeDocumentAccessAction,
  readProjectDocumentAccessPolicy,
  updateProjectDocumentAccessPolicy,
  type AccessPolicyBody
} from './projectDocumentAccessPolicy'

type Row = Record<string, unknown>
const id = /^[1-9]\d*$/
// 访问策略治理与文档读写是不同的授权面：改策略的门槛是项目经理，不是能编辑
// 文档。因此单列资源，读与改再分成两条能力，read 不蕴含 manage。
const capabilities = Object.freeze({ read: 'aims:project-document-access:read', manage: 'aims:project-document-access:manage' })
const readActions = new Set(['policy-read', 'check', 'audit'])
const actions = new Set([...readActions, 'policy-update'])

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function handleEnterpriseProjectDocumentAccessService(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'POST' || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '项目文档访问策略代理请求无效' })
  const auth = await requireConsoleAuthContext(event)
  const body = await readBody(event)
  const envelope = body?.serviceCommand
  const command = envelope?.command as Row | undefined
  const action = text(command?.action)
  if (!actions.has(action)) throw createError({ statusCode: 403, message: '项目文档访问策略代理命令无效' })
  const capability = readActions.has(action) ? capabilities.read : capabilities.manage
  // capability 按动作精确校验：只读令牌打不进改策略。
  requireServiceScope(event, { scope: capability, allowedApps: ['enterprise'] })
  const gateway = resolveTrustedTenantGatewayContext(event)
  if (auth.appCode !== 'enterprise' || auth.clientCode !== 'enterprise.runtime' || !auth.tenant || !auth.deployment || !gateway || gateway.tenant !== auth.tenant || gateway.appCode !== 'aims' || !gateway.deployment) throw createError({ statusCode: 403, message: '项目文档访问策略代理来源或部署绑定无效' })
  const actorUid = text(command?.actorUid)
  const projectId = text(command?.projectId)
  const documentId = text(command?.documentId)
  const payload = command?.payload
  if (
    !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
    || !envelope || !command
    || Object.keys(command).some(key => !['actorUid', 'tenant', 'sourceDeployment', 'targetDeployment', 'action', 'projectId', 'documentId', 'payload'].includes(key))
    || !actorUid || !id.test(projectId) || !id.test(documentId)
    || !Number.isSafeInteger(Number(projectId)) || !Number.isSafeInteger(Number(documentId))
    || (action === 'policy-read' && payload !== undefined)
    || ((action === 'check' || action === 'audit' || action === 'policy-update') && (!payload || typeof payload !== 'object' || Array.isArray(payload)))
    || text(command.tenant) !== auth.tenant
    || text(command.sourceDeployment) !== auth.deployment
    || text(command.targetDeployment) !== gateway.deployment
    || envelope.targetApp !== 'aims'
    || envelope.operationCode !== `enterprise.aims.project-document-access.${action}.v1`
    || envelope.requiredCapability !== capability
    || envelope.commandSchemaVersion !== 'enterprise-project-document-access.v1'
    || envelope.commandSha256 !== await hashServiceCommandPayload(command)
  ) throw createError({ statusCode: 403, message: '项目文档访问策略代理命令无效' })
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401, message: '缺少服务令牌' })
  await verifyServiceCommandRuntimeHeaders({ event, token, method: 'POST', requestTarget: getRequestURL(event).pathname, requestId: getHeader(event, 'x-request-id') || '', tenantCode: auth.tenant, sourceDeploymentCode: auth.deployment, targetDeploymentCode: gateway.deployment, sourceApp: 'enterprise', sourceClientId: 'enterprise.runtime', targetApp: 'aims', envelope, readHeader: name => getHeader(event, name) })

  // Manifest 只有 projects 入口权限；改策略仍须下方共享领域逻辑证明项目经理关系。
  const subjectAction = 'view'
  const subject = await loadSubjectScopedAuthorizationByService({ event, timeoutMs: 100000, subjectUid: actorUid, purpose: `enterprise_project_document_access_${action.replace(/-/g, '_')}`, resourceCode: 'projects', action: subjectAction })
  if (!subject.grants.some(grant => grant.permissions.some(permission => permission.appCode === 'aims' && permission.resourceCode === 'projects' && authorizationActionsAllow([permission.action], subjectAction, subject.actionPolicy)))) throw createError({ statusCode: 403, message: '无项目文档访问策略权限' })

  // 项目成员 / 项目经理这一层仍由下面的共用函数判定，与独立 Aims 路由同源。
  const numericProjectId = Number(projectId)
  const numericDocumentId = Number(documentId)
  const input = (payload || {}) as Row
  if (action === 'policy-read') return await readProjectDocumentAccessPolicy(event, actorUid, numericProjectId, numericDocumentId)
  if (action === 'check') return await checkProjectDocumentAccess(event, actorUid, numericProjectId, numericDocumentId, normalizeDocumentAccessAction(input.action))
  if (action === 'audit') return await listProjectDocumentAccessAudit(event, actorUid, numericProjectId, numericDocumentId, Number(input.page), Number(input.pageSize))
  return await updateProjectDocumentAccessPolicy(event, actorUid, numericProjectId, numericDocumentId, input as unknown as AccessPolicyBody)
}
