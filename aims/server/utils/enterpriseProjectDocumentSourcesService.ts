import { authorizationActionsAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createError, getHeader, getQuery, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { requireConsoleAuthContext } from '@hzy/foundation/server/utils/consoleOidc'
import { loadSubjectScopedAuthorizationByService } from '@hzy/foundation/server/utils/subjectScopedAuthorization'
import { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { resolveTrustedTenantGatewayContext } from '@hzy/foundation/server/utils/tenantGatewayTrust'
import { getGitRepositoryFile, listGitMarkdownTree } from '@hzy/foundation/server/utils/gitIntegration'
import { requireServiceScope } from './serviceAuth'
import { searchDepartmentDocuments, searchProjectDocuments } from './codocsApi'
import { hasDepartmentAccess } from './userDepartments'
import { assertAimsProjectRepositoryAccess } from './projectDocumentAccess'
import { buildAimsProjectRuntimeAccessQuery } from './aimsProjectRuntimeAccess'
import { forwardAimsRuntimeGet } from './aimsRuntimeForward'

type Row = Record<string, unknown>
const id = /^[1-9]\d*$/
// 四个动作都是“可附加为项目文档的候选来源”的只读查询，且每一条都在服务端按
// 操作者本人的部门 / 项目 / 仓库访问权重新判定，因此共用一个 capability；这与
// preview/download 不同——那里 Codocs ACL 本身就把 download 当作独立动作。
const capability = 'aims:project-document-sources:read'
const actions = new Set(['dept-documents', 'project-documents', 'repo-tree', 'repo-doc'])
const code = /^[A-Za-z0-9._-]{1,120}$/
const ref = /^[A-Za-z0-9._/-]{1,200}$/

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export async function handleEnterpriseProjectDocumentSourcesService(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (event.method !== 'POST' || Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '项目文档来源代理请求无效' })
  const auth = await requireConsoleAuthContext(event)
  requireServiceScope(event, { scope: capability, allowedApps: ['enterprise'] })
  const gateway = resolveTrustedTenantGatewayContext(event)
  if (auth.appCode !== 'enterprise' || auth.clientCode !== 'enterprise.runtime' || !auth.tenant || !auth.deployment || !gateway || gateway.tenant !== auth.tenant || gateway.appCode !== 'aims' || !gateway.deployment) throw createError({ statusCode: 403, message: '项目文档来源代理来源或部署绑定无效' })
  const body = await readBody(event)
  const envelope = body?.serviceCommand
  const command = envelope?.command as Row | undefined
  const action = text(command?.action)
  const actorUid = text(command?.actorUid)
  const projectId = text(command?.projectId)
  const deptCode = text(command?.deptCode)
  const repoProjectCode = text(command?.repoProjectCode)
  const path = text(command?.path)
  const gitRef = text(command?.ref)
  const commitId = text(command?.commitId)
  if (
    !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
    || !envelope || !command
    || Object.keys(command).some(key => !['actorUid', 'tenant', 'sourceDeployment', 'targetDeployment', 'action', 'projectId', 'deptCode', 'repoProjectCode', 'path', 'ref', 'commitId'].includes(key))
    || !actions.has(action) || !actorUid
    // 每个动作只接受自己需要的参数，避免用一个宽命令体打到别的分支
    || (action === 'dept-documents' && (!deptCode || !code.test(deptCode) || projectId || repoProjectCode || path))
    || (action === 'project-documents' && (!id.test(projectId) || !Number.isSafeInteger(Number(projectId)) || deptCode || repoProjectCode || path))
    || (action === 'repo-tree' && (!id.test(projectId) || !code.test(repoProjectCode) || deptCode || path))
    || (action === 'repo-doc' && (!id.test(projectId) || !code.test(repoProjectCode) || !path || path.length > 400 || deptCode))
    || (gitRef && !ref.test(gitRef)) || (commitId && !code.test(commitId))
    || text(command.tenant) !== auth.tenant
    || text(command.sourceDeployment) !== auth.deployment
    || text(command.targetDeployment) !== gateway.deployment
    || envelope.targetApp !== 'aims'
    || envelope.operationCode !== `enterprise.aims.project-document-sources.${action}.v1`
    || envelope.requiredCapability !== capability
    || envelope.commandSchemaVersion !== 'enterprise-project-document-sources.v1'
    || envelope.commandSha256 !== await hashServiceCommandPayload(command)
  ) throw createError({ statusCode: 403, message: '项目文档来源代理命令无效' })
  const token = /^Bearer\s+(.+)$/i.exec(getHeader(event, 'authorization') || '')?.[1]
  if (!token) throw createError({ statusCode: 401, message: '缺少服务令牌' })
  await verifyServiceCommandRuntimeHeaders({ event, token, method: 'POST', requestTarget: getRequestURL(event).pathname, requestId: getHeader(event, 'x-request-id') || '', tenantCode: auth.tenant, sourceDeploymentCode: auth.deployment, targetDeploymentCode: gateway.deployment, sourceApp: 'enterprise', sourceClientId: 'enterprise.runtime', targetApp: 'aims', envelope, readHeader: name => getHeader(event, name) })

  const subject = await loadSubjectScopedAuthorizationByService({ event, timeoutMs: 100000, subjectUid: actorUid, purpose: 'enterprise_project_document_sources_read', resourceCode: 'projects', action: 'view' })
  if (!subject.grants.some(grant => grant.permissions.some(permission => permission.appCode === 'aims' && permission.resourceCode === 'projects' && authorizationActionsAllow([permission.action], 'view', subject.actionPolicy)))) throw createError({ statusCode: 403, message: '无项目文档查看权限' })

  // 以下每个分支都复用独立 Aims 路由的同一套访问判定，只是把会话 uid 换成
  // 已验签命令里的 actorUid：宿主不得借自身运行身份放宽任何一层。
  if (action === 'dept-documents') {
    if (!await hasDepartmentAccess(event, actorUid, deptCode)) throw createError({ statusCode: 403, message: '无权访问该部门文档列表' })
    const res = await searchDepartmentDocuments({ event, deptCode, actorUid })
    return { code: 0, data: {
      folders: (res.data?.folders || []).map(folder => ({ id: folder.id, name: folder.name, parentId: folder.parent_id, updatedAt: folder.updated_at })),
      items: (res.data?.items || []).map(item => ({ uuid: item.uuid, title: item.title, ownerUid: item.ownerUid, deptCode: item.deptCode, folderId: item.folderId ?? null, folderName: item.folderName ?? null, aiAbstract: item.aiAbstract, updatedAt: item.updatedAt, contentSize: item.contentSize }))
    } }
  }

  if (action === 'project-documents') {
    const numericProjectId = Number(projectId)
    const context = await forwardAimsRuntimeGet<{ gitGroup: string | null }>(
      event,
      `/v1/aims/projects/${encodeURIComponent(projectId)}/codocs-project-documents-context`,
      { uid: actorUid, query: await buildAimsProjectRuntimeAccessQuery(event, { projectId: numericProjectId, uid: actorUid }) }
    )
    if (!context.gitGroup) return { code: 0, data: { folders: [], items: [], gitGroup: null } }
    const res = await searchProjectDocuments({ event, projectCode: context.gitGroup, actorUid })
    return { code: 0, data: {
      gitGroup: context.gitGroup,
      folders: (res.data?.folders || []).map(folder => ({ id: folder.id, name: folder.name, parentId: folder.parent_id, updatedAt: folder.updated_at })),
      items: res.data?.items || []
    } }
  }

  // 仓库文档：项目必须已绑定该仓库，凭据由 Foundation git integration 解析，
  // 宿主与浏览器都拿不到 Token。
  await assertAimsProjectRepositoryAccess(event, Number(projectId), repoProjectCode, actorUid)
  if (action === 'repo-tree') {
    return { code: 0, message: 'success', data: await listGitMarkdownTree({ repoPath: repoProjectCode, ref: gitRef || undefined }) }
  }
  const file = await getGitRepositoryFile({ repoPath: repoProjectCode, path, ref: gitRef || undefined, commitId: commitId || undefined })
  return { code: 0, message: 'success', data: { path: file.path, name: file.name, size: file.size, encoding: file.encoding, content: file.content, ref: file.ref } }
}
