import { authorizationActionsAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createError, getHeader, getQuery, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { loadSubjectScopedAuthorizationByService } from '@hzy/foundation/server/utils/subjectScopedAuthorization'
import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { requireServiceScope } from './serviceAuth'
import {
  checkCodocsDocumentAccess,
  getCodocsProjectCabinetDownloadUrl,
  getCodocsProjectCabinetPreviewUrl
} from './codocsApi'
import { getProjectDocumentContext } from './projectDocumentAccess'

type Row = Record<string, unknown>
const id = /^[1-9]\d*$/
// 预览沿用读取 capability；下载是导出性质的敏感动作，按根 CLAUDE.md 单独声明，
// 不由 :read 蕴含。两者在 Codocs ACL 里也是不同 action。
const capabilities = Object.freeze({ preview: 'aims:project-documents:read', download: 'aims:project-documents:download' })
const actions = Object.freeze({ preview: 'view', download: 'download' } as const)

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function handleEnterpriseProjectDocumentFilesService(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'POST' || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '项目文档文件代理请求无效' })
  const auth = await requireConsoleAuthContext(event)
  const body = await readBody(event)
  const envelope = body?.serviceCommand
  const command = envelope?.command as Row | undefined
  const action = text(command?.action)
  if (action !== 'preview' && action !== 'download') throw createError({ statusCode: 403, message: '项目文档文件代理命令无效' })
  const capability = capabilities[action]
  // capability 按动作精确校验：预览令牌打不进下载，反之亦然。
  requireServiceScope(event, { scope: capability, allowedApps: ['enterprise'] })
  const gateway = resolveTrustedTenantGatewayContext(event)
  if (auth.appCode !== 'enterprise' || auth.clientCode !== 'enterprise.runtime' || !auth.tenant || !auth.deployment || !gateway || gateway.tenant !== auth.tenant || gateway.appCode !== 'aims' || !gateway.deployment) throw createError({ statusCode: 403, message: '项目文档文件代理来源或部署绑定无效' })
  const actorUid = text(command?.actorUid)
  const projectId = text(command?.projectId)
  const documentId = text(command?.documentId)
  if (
    !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
    || !envelope || !command
    || Object.keys(command).some(key => !['actorUid', 'tenant', 'sourceDeployment', 'targetDeployment', 'projectId', 'documentId', 'action'].includes(key))
    || !actorUid || !id.test(projectId) || !id.test(documentId)
    || !Number.isSafeInteger(Number(projectId)) || !Number.isSafeInteger(Number(documentId))
    || text(command.tenant) !== auth.tenant
    || text(command.sourceDeployment) !== auth.deployment
    || text(command.targetDeployment) !== gateway.deployment
    || envelope.targetApp !== 'aims'
    || envelope.operationCode !== `enterprise.aims.project-document-files.${action}.v1`
    || envelope.requiredCapability !== capability
    || envelope.commandSchemaVersion !== 'enterprise-project-document-files.v1'
    || envelope.commandSha256 !== await hashServiceCommandPayload(command)
  ) throw createError({ statusCode: 403, message: '项目文档文件代理命令无效' })
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401, message: '缺少服务令牌' })
  await verifyServiceCommandRuntimeHeaders({ event, token, method: 'POST', requestTarget: getRequestURL(event).pathname, requestId: getHeader(event, 'x-request-id') || '', tenantCode: auth.tenant, sourceDeploymentCode: auth.deployment, targetDeploymentCode: gateway.deployment, sourceApp: 'enterprise', sourceClientId: 'enterprise.runtime', targetApp: 'aims', envelope, readHeader: name => getHeader(event, name) })

  // 委托 actor 的资源级资格：宿主不得借自身 runtime 身份替无权用户取文件。
  const subject = await loadSubjectScopedAuthorizationByService({ event, timeoutMs: 100000, subjectUid: actorUid, purpose: `enterprise_project_document_${action}`, resourceCode: 'projects', action: 'view' })
  if (!subject.grants.some(grant => grant.permissions.some(permission => permission.appCode === 'aims' && permission.resourceCode === 'projects' && authorizationActionsAllow([permission.action], 'view', subject.actionPolicy)))) throw createError({ statusCode: 403, message: '无项目文档查看权限' })

  // 以下与独立 Aims 的 download/preview 路由同源：同一上下文解析、同一 Codocs ACL 复核。
  const context = await getProjectDocumentContext(event, Number(projectId), Number(documentId), actorUid)
  const access = await checkCodocsDocumentAccess({
    event,
    documentUuid: context.documentUuid,
    documentRefType: context.documentRefType,
    sourceProjectCode: context.projectCode,
    action: actions[action],
    actorUid,
    actorProjectCodes: context.actorProjectCodes,
    actorDeptCodes: context.actorDeptCodes,
    actorRoles: context.actorRoles
  })
  if (!access.allowed) throw createError({ statusCode: 403, message: action === 'download' ? '无权下载该文档' : '无权预览该文档' })
  if (context.documentRefType !== 'cabinet_file') throw createError({ statusCode: 400, message: action === 'download' ? '当前文档不支持文件柜下载' : '当前文档不支持文件柜预览' })
  if (!context.projectCode) throw createError({ statusCode: 500, message: '项目编码缺失，无法访问项目文件' })

  const expectedOssPath = text(
    context.document.ossPath
    ?? context.document.oss_path
    ?? context.document.repoFilePath
    ?? context.document.repo_file_path
  )
  const params = { event, fileUuid: context.documentUuid, projectCode: context.projectCode, expectedOssPath }
  if (action === 'download') {
    const download = await getCodocsProjectCabinetDownloadUrl(params)
    // 只回签名地址，由宿主转成 302；宿主不代理文件字节，也不暴露 ossPath。
    return { code: 0, data: { url: download.url } }
  }
  const preview = await getCodocsProjectCabinetPreviewUrl(params)
  return { code: 0, data: { ...preview, access } }
}
