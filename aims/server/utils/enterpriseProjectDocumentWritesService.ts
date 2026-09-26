import { authorizationActionsAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createError, getHeader, getQuery, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { loadSubjectScopedAuthorizationByService } from '@hzy/foundation/server/utils/subjectScopedAuthorization'
import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireServiceScope } from './serviceAuth'
import { uploadProjectOtherDocument } from './projectDocumentUpload'
import {
  createProjectDocumentIndexEntry,
  createProjectMarkdownDocument,
  deleteProjectDocumentEntry,
  type CreateDocumentIndexBody,
  type CreateMarkdownDocumentBody
} from './projectDocumentWrites'

type Row = Record<string, unknown>
const id = /^[1-9]\d*$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// 写入与只读分开：read 不蕴含 write，宿主要写必须单独持有这条 grant。
const capability = 'aims:project-documents:write'
const actions = new Set(['create-index', 'create-markdown', 'upload-file', 'delete'])

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function handleEnterpriseProjectDocumentWritesService(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'POST' || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '项目文档写入代理请求无效' })
  const auth = await requireConsoleAuthContext(event)
  requireServiceScope(event, { scope: capability, allowedApps: ['enterprise'] })
  const gateway = resolveTrustedTenantGatewayContext(event)
  if (auth.appCode !== 'enterprise' || auth.clientCode !== 'enterprise.runtime' || !auth.tenant || !auth.deployment || !gateway || gateway.tenant !== auth.tenant || gateway.appCode !== 'aims' || !gateway.deployment) throw createError({ statusCode: 403, message: '项目文档写入代理来源或部署绑定无效' })
  const body = await readBody(event)
  const envelope = body?.serviceCommand
  const command = envelope?.command as Row | undefined
  const action = text(command?.action)
  const actorUid = text(command?.actorUid)
  const documentUuid = text(command?.documentUuid)
  const documentId = text(command?.documentId)
  const projectId = text(command?.projectId)
  const payload = command?.payload
  if (
    !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
    || !envelope || !command
    || Object.keys(command).some(key => !['actorUid', 'tenant', 'sourceDeployment', 'targetDeployment', 'action', 'documentUuid', 'documentId', 'projectId', 'payload'].includes(key))
    || !actions.has(action) || !actorUid
    // 幂等键由业务键派生，因此写操作必须带稳定业务键：新建带文档 uuid，
    // 删除带文档 id。缺了就不是可安全重放的请求。
    || (action === 'create-index' && (!uuidPattern.test(documentUuid) || documentId || projectId))
    || (['create-markdown', 'upload-file'].includes(action) && (!uuidPattern.test(documentUuid) || !id.test(projectId) || !Number.isSafeInteger(Number(projectId)) || documentId))
    || (action === 'delete' && (!id.test(documentId) || documentUuid || projectId))
    || (action !== 'delete' && (!payload || typeof payload !== 'object' || Array.isArray(payload)))
    || (action === 'delete' && payload !== undefined)
    || text(command.tenant) !== auth.tenant
    || text(command.sourceDeployment) !== auth.deployment
    || text(command.targetDeployment) !== gateway.deployment
    || envelope.targetApp !== 'aims'
    || envelope.operationCode !== `enterprise.aims.project-document-writes.${action}.v1`
    || envelope.requiredCapability !== capability
    || envelope.commandSchemaVersion !== 'enterprise-project-document-writes.v1'
    || envelope.commandSha256 !== await hashServiceCommandPayload(command)
  ) throw createError({ statusCode: 403, message: '项目文档写入代理命令无效' })
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401, message: '缺少服务令牌' })
  await verifyServiceCommandRuntimeHeaders({ event, token, method: 'POST', requestTarget: getRequestURL(event).pathname, requestId: getHeader(event, 'x-request-id') || '', tenantCode: auth.tenant, sourceDeploymentCode: auth.deployment, targetDeploymentCode: gateway.deployment, sourceApp: 'enterprise', sourceClientId: 'enterprise.runtime', targetApp: 'aims', envelope, readHeader: name => getHeader(event, name) })

  // 委托 actor 必须自己具备编辑资格；宿主不得借运行身份替无权用户写入。
  const subject = await loadSubjectScopedAuthorizationByService({ event, timeoutMs: 100000, subjectUid: actorUid, purpose: 'enterprise_project_document_write', resourceCode: 'projects', action: 'view' })
  if (!subject.grants.some(grant => grant.permissions.some(permission => permission.appCode === 'aims' && permission.resourceCode === 'projects' && authorizationActionsAllow([permission.action], 'view', subject.actionPolicy)))) throw createError({ statusCode: 403, message: '无项目文档编辑权限' })

  // 下面三条与独立 Aims 路由调用的是同一批函数，项目成员、删除人和
  // Codocs 侧的判定都在函数内部完成。
  if (action === 'delete') return await deleteProjectDocumentEntry(event, actorUid, Number(documentId))
  if (action === 'create-markdown') {
    return await createProjectMarkdownDocument(event, actorUid, Number(projectId), { ...(payload as CreateMarkdownDocumentBody), uuid: documentUuid })
  }
  if (action === 'upload-file') {
    const file = payload as Row
    const encoded = text(file.contentBase64)
    if (!encoded || encoded.length > Math.ceil(10 * 1024 * 1024 / 3) * 4) throw createError({ statusCode: 400, message: '文件内容无效或超过 10MB' })
    const data = Buffer.from(encoded, 'base64')
    if (data.toString('base64') !== encoded) throw createError({ statusCode: 400, message: '文件内容无效' })
    return await uploadProjectOtherDocument(event, actorUid, Number(projectId), {
      fileName: text(file.fileName), data,
      contentType: text(file.contentType), docCategory: text(file.docCategory), documentUuid
    })
  }
  // 新建索引：uuid 由已验签命令决定，调用方不能在 body 里另塞一个。
  return await createProjectDocumentIndexEntry(event, actorUid, { ...(payload as CreateDocumentIndexBody), uuid: documentUuid })
}
