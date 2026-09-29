import { createError, getHeader, getQuery, getRequestURL, readBody, type H3Event } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireCodocsServiceAuth } from '../lib/serviceAuthPolicy'
import { callCodocsTenantRuntime } from './codocsRuntime'
import { createProjectDocumentContent } from './projectDocumentCreation'

const actions = new Set(['create', 'search', 'summary', 'policy-read', 'policy-update', 'check', 'audit'])
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function projectDocumentAccessService(event: H3Event) {
  const auth = await requireConsoleAuthContext(event)
  const gateway = resolveTrustedTenantGatewayContext(event)
  if (event.method !== 'POST' || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '文档服务请求无效' })
  if (!gateway || gateway.appCode !== 'codocs' || gateway.tenant !== auth.tenant || !auth.deployment) throw createError({ statusCode: 403, message: '文档服务部署绑定无效' })
  const body = await readBody(event)
  const envelope = body?.serviceCommand
  const command = envelope?.command
  const action = text(command?.action)
  const capability = action === 'create' ? 'codocs:project-document-access:create' : action === 'policy-update' ? 'codocs:project-document-access:manage' : 'codocs:project-document-access:read'
  requireCodocsServiceAuth(auth, { scope: capability, allowedApps: ['aims'], allowedClientCodes: ['aims.runtime'], exactScope: true })
  if (!body || Object.keys(body).length !== 1 || !command || Array.isArray(command) || !actions.has(action)
    || !text(command.actorUid) || (action !== 'search' && !uuid.test(text(command.documentUuid)))
    || envelope.targetApp !== 'codocs' || envelope.requiredCapability !== capability
    || envelope.commandSchemaVersion !== 'aims-project-document-access.v1'
    || envelope.operationCode !== `aims.codocs.project-document-access.${action}.v1`
    || envelope.commandSha256 !== await hashServiceCommandPayload(command)) throw createError({ statusCode: 403, message: '文档服务命令无效' })
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401, message: '缺少服务令牌' })
  await verifyServiceCommandRuntimeHeaders({ event, token, method: 'POST', requestTarget: getRequestURL(event).pathname, requestId: getHeader(event, 'x-request-id') || '', tenantCode: gateway.tenant, sourceDeploymentCode: auth.deployment, targetDeploymentCode: gateway.deployment, sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'codocs', envelope, readHeader: name => getHeader(event, name) })
  const ref = text(command.documentRefType) || 'codocs_document'
  if (!['codocs_document', 'cabinet_file'].includes(ref)) throw createError({ statusCode: 400, message: '文档类型无效' })
  const projectCode = text(command.sourceProjectCode || command.projectCode)
  const documentUuid = text(command.documentUuid)
  if (action === 'create') {
    if (!projectCode) throw createError({ statusCode: 400, message: '缺少项目编码' })
    return await createProjectDocumentContent(event, { uuid: documentUuid, title: command.title,
      ownerUid: command.actorUid, content: command.content, docType: 'project',
      deptCode: command.deptCode, projectCode, folderPath: command.folderPath })
  }
  const query: Record<string, unknown> = { documentRefType: ref, sourceProjectCode: projectCode }
  const read = <T>(path: string, extra: Record<string, unknown> = {}) => callCodocsTenantRuntime<T>(event, path, { query: { ...query, ...extra }, scope: 'codocs.read' })
  if (action === 'search') {
    if (!projectCode) throw createError({ statusCode: 400, message: '缺少项目编码' })
    const limit = Math.min(Math.max(Number(command.pageSize) || 100, 1), 200)
    const [folders, documents] = await Promise.all([
      read<{ items?: unknown[] }>('/v1/codocs/folders', { folder_type: 'project', project_code: projectCode, limit, page: 1 }),
      read<{ items?: Record<string, unknown>[] }>('/v1/codocs/documents', { type: 'project', project_code: projectCode, limit, page: 1 })
    ])
    return { code: 0, data: { folders: folders.items || [], items: (documents.items || []).map(item => ({
      uuid: item.uuid, title: item.title, docType: item.doc_type, ownerUid: item.owner_uid,
      deptCode: item.dept_code, projectCode: item.project_code, folderId: item.folder_id,
      folderName: item.folder_name, contentSize: item.content_size, aiAbstract: null, updatedAt: item.updated_at
    })) } }
  }
  if (action === 'summary') return { code: 0, data: await read(`/v1/codocs/documents/${documentUuid}`) }
  if (action === 'policy-read') return { code: 0, data: await read(`/v1/codocs/document-access/policies/${documentUuid}`) }
  if (action === 'audit') return { code: 0, data: await read('/v1/codocs/document-access/audit-logs', { documentUuid, page: Math.max(Number(command.page) || 1, 1), pageSize: Math.min(Math.max(Number(command.pageSize) || 20, 1), 100) }) }
  if (action === 'check') {
    if (!['view', 'download', 'edit'].includes(text(command.accessAction))) throw createError({ statusCode: 400, message: '文档权限动作无效' })
    const facts = (value: unknown) => {
      if (!Array.isArray(value) || value.length > 500 || value.some(item => typeof item !== 'string' || !item || item.includes(',') || item.length > 191)) throw createError({ statusCode: 400, message: '文档范围事实无效' })
      return value.join(',')
    }
    return { code: 0, data: await callCodocsTenantRuntime(event, '/v1/codocs/document-access/check', {
      method: 'POST', scope: 'codocs.read',
      query: { codocs_trusted_aims_document_access: '1', aims_trusted_document_access_project_codes: facts(command.actorProjectCodes || []), aims_trusted_document_access_roles: facts(command.actorRoles || []) },
      body: { documentUuid, documentRefType: ref, sourceApp: 'aims', sourceProjectCode: projectCode, action: command.accessAction }
    }) }
  }
  // The Aims handler proves project-manager authority before signing. Only
  // policy fields are forwarded, never arbitrary runtime/actor overrides.
  const policy: Record<string, unknown> = { documentRefType: ref, sourceApp: 'aims', sourceProjectCode: projectCode }
  for (const key of ['lifecycleStage', 'confidentialityLevel', 'defaultPermission', 'allowInternalAccess', 'allowCrossProject', 'readonly', 'grants']) policy[key] = command[key]
  return { code: 0, data: await callCodocsTenantRuntime(event, `/v1/codocs/document-access/policies/${documentUuid}`, { method: 'PUT', scope: 'codocs.write', body: policy }) }
}
