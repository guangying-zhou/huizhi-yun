import { createError, getHeader, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import {
  callEnterpriseRuntime,
  enterpriseRuntimePermitExpiresAt,
  prepareEnterpriseRuntime,
  requireEnterpriseUser
} from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { optionalReadPagination } from '@hzy/foundation/shared/utils/optionalReadPagination'
import { projectRead, enterpriseAimsProjectScope } from './enterpriseAimsProjects'
import { enterpriseAimsPersonnel } from './enterpriseAimsPersonnel'
import { loadProjectCommandAuthorization } from '@hzy/foundation/server/utils/projectCommandAuthorization'

// 项目集与项目彻底删除。
//
// 与 Aims 中间件同一套判定：
//   - 项目集写操作要求 portfolios:admin，通过后才注入
//     current_user_can_manage_portfolios=1；调用方自带的同名参数一律丢弃。
//   - 彻底删除项目要求 admin:admin（对应 Aims 的 requireAimsProjectDeleteAccess），
//     项目管理员范围由 enterpriseAimsProjectScope 服务端算出。

type PortfolioOperation
  = | 'aims.project-portfolio-list' | 'aims.project-portfolio-create'
    | 'aims.project-portfolio-update' | 'aims.project-portfolio-delete'
    | 'aims.project-portfolio-members-list' | 'aims.project-portfolio-members-save' | 'aims.project-portfolio-doc-repo-save'
    | 'aims.project-portfolio-documents-list' | 'aims.project-portfolio-documents-content' | 'aims.project-portfolio-documents-create'
    | 'aims.project-portfolio-documents-delete' | 'aims.project-portfolio-documents-policy'
    | 'aims.project-delete'

const listKeys = new Set(['page', 'pageSize', 'search', 'status', 'defaultCategory'])
const numericID = /^[1-9]\d*$/

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function requireID(event: H3Event, label: string) {
  const value = text(getRouterParam(event, 'id'))
  if (!numericID.test(value) || !Number.isSafeInteger(Number(value))) {
    throw createError({ statusCode: 400, message: `${label}标识无效` })
  }
  return value
}

async function payloadOf(event: H3Event) {
  const body = await readBody(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: '请求体无效' })
  }
  return body as Record<string, unknown>
}

const documentWrites = new Set<PortfolioOperation>([
  'aims.project-portfolio-documents-create', 'aims.project-portfolio-documents-delete', 'aims.project-portfolio-documents-policy'
])

interface PortfolioCall {
  projectId?: string
  objectId?: string
  subId?: string
  query?: Record<string, string>
  payload?: Record<string, unknown>
  idempotencyKey?: string
}

async function portfolioCall<T>(event: H3Event, operation: PortfolioOperation, call: PortfolioCall = {}): Promise<T> {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)

  const query: Record<string, string> = { ...(call.query || {}) }
  // 权限派生标志只能由本层注入，绝不透传调用方输入。
  delete query.current_user_can_manage_portfolios

  let resource = 'project-portfolios'
  let action: 'view' | 'edit' | 'execute' = 'view'
  if (operation === 'aims.project-delete') {
    resource = 'project-deletion'
    action = 'execute'
    if (!authorizationResourcesAllow(authorization.resources, 'admin', 'admin', authorization.actionPolicies?.admin)) {
      throw createError({ statusCode: 403, message: '仅系统管理员可以彻底删除项目' })
    }
  } else if (operation === 'aims.project-portfolio-documents-list' || operation === 'aims.project-portfolio-documents-content') {
    // 项目集文档只读列表：人员权限 portfolios:view 与“当前关系”必须同时成立。
    // 关系（负责人、有效成员、组内项目成员）由 Runtime 用已验签 actor 计算，本层不传任何关系或管理标志。
    if (!authorizationResourcesAllow(authorization.resources, 'portfolios', 'view', authorization.actionPolicies?.portfolios)) {
      throw createError({ statusCode: 403, message: '无项目集查看权限' })
    }
  } else if (documentWrites.has(operation)) {
    // 项目集文档写入：人员权限 portfolios:edit 与当前关系（管理者/参与者，策略维护仅管理者）必须同时成立。
    // 关系由 Runtime 在写事务内对锁定行复核；本层不注入管理标志，也不传任何归属或关系。
    action = 'edit'
    if (!authorizationResourcesAllow(authorization.resources, 'portfolios', 'edit', authorization.actionPolicies?.portfolios)) {
      throw createError({ statusCode: 403, message: '无项目集编辑权限' })
    }
  } else if (operation === 'aims.project-portfolio-members-list') {
    // 成员列表：能查看项目集即可读取；管理标志只影响返回的 canManage，写入仍在 Runtime 复核。
    if (!authorizationResourcesAllow(authorization.resources, 'portfolios', 'view', authorization.actionPolicies?.portfolios)) {
      throw createError({ statusCode: 403, message: '无项目集查看权限' })
    }
    if (authorizationResourcesAllow(authorization.resources, 'portfolios', 'admin', authorization.actionPolicies?.portfolios)) {
      query.current_user_can_manage_portfolios = '1'
    }
  } else if (operation !== 'aims.project-portfolio-list') {
    action = 'edit'
    if (!authorizationResourcesAllow(authorization.resources, 'portfolios', 'admin', authorization.actionPolicies?.portfolios)) {
      throw createError({ statusCode: 403, message: '仅 AIMS 管理员可以维护项目集' })
    }
    query.current_user_can_manage_portfolios = '1'
  } else if (!authorizationResourcesAllow(authorization.resources, 'projects', 'view', authorization.actionPolicies?.projects)) {
    throw createError({ statusCode: 403, message: '无项目查看权限' })
  }

  if (operation === 'aims.project-portfolio-create' && call.payload) await enterpriseAimsPersonnel(event, user, call.payload, 'ownerUid', 'project-portfolios', 'new', 'create')
  await prepareEnterpriseRuntime(event, operation)
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  const projectWriteAuthorization = operation === 'aims.project-delete'
    ? { ...await loadProjectCommandAuthorization(event, user, { resource: 'admin', action: 'admin', projectId: call.projectId || '', workItemId: '' }), objectId: '', subId: '' }
    : undefined
  return await callEnterpriseRuntime<T>(event, operation, {
    ...(projectWriteAuthorization ? { projectWriteAuthorization } : {}),
    tenant: user.tenant,
    deployment: user.deployment,
    ...(call.projectId ? { projectId: call.projectId } : {}),
    ...(call.objectId ? { objectId: call.objectId } : {}),
    ...(call.subId ? { subId: call.subId } : {}),
    query: { ...query, ...scope },
    ...(call.payload ? { payload: call.payload } : {}),
    authorization: {
      actorUid: user.uid,
      tenant: user.tenant,
      deployment: user.deployment,
      resource,
      action,
      expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  }, call.idempotencyKey ? { idempotencyKey: call.idempotencyKey } : {})
}

export async function enterpriseAimsPortfolioList(event: H3Event) {
  const query: Record<string, string> = {}
  for (const [key, raw] of Object.entries(getQuery(event))) {
    if (!listKeys.has(key) || Array.isArray(raw)) throw createError({ statusCode: 400, message: '项目集筛选参数无效' })
    const value = text(raw)
    if (!value || value.length > 200) throw createError({ statusCode: 400, message: '项目集筛选参数无效' })
    query[key] = value
  }
  try {
    Object.assign(query, optionalReadPagination(getQuery(event)))
  } catch {
    throw createError({ statusCode: 400, message: '项目集分页参数无效' })
  }
  const response = await projectRead(event, 'aims.project-list', {
    projection: 'portfolios', page: query.page || '1', pageSize: query.pageSize || '20',
    ...(query.search ? { rootSearch: query.search } : {}),
    ...(query.status ? { rootStatus: query.status } : {}),
    ...(query.defaultCategory ? { rootCategory: query.defaultCategory } : {})
  })
  const data = response.data as { items: Array<{ portfolio: Record<string, unknown>, canDelete: boolean }> }
  return { ...response, data: { ...data, items: data.items.map(item => ({ ...item.portfolio, canDelete: item.canDelete })) } }
}

export async function enterpriseAimsPortfolioCreate(event: H3Event) {
  const idempotencyKey = String(getHeader(event, 'Idempotency-Key') || '').trim()
  if (!idempotencyKey || idempotencyKey.length > 191) throw createError({ statusCode: 400, message: '请提供有效操作标识' })
  return await portfolioCall(event, 'aims.project-portfolio-create', { payload: await payloadOf(event), idempotencyKey })
}

export async function enterpriseAimsPortfolioUpdate(event: H3Event) {
  const objectId = requireID(event, '项目集')
  const payload = await payloadOf(event)
  const idempotencyKey = String(getHeader(event, 'Idempotency-Key') || '').trim()
  if (!idempotencyKey || idempotencyKey.length > 191 || typeof payload.expectedVersion !== 'string' || !/^[a-f0-9]{64}$/.test(payload.expectedVersion)) throw createError({ statusCode: 400, message: '请提供有效操作标识和项目集版本' })
  return await portfolioCall(event, 'aims.project-portfolio-update', { objectId, payload, idempotencyKey })
}

export async function enterpriseAimsPortfolioDelete(event: H3Event) {
  const objectId = requireID(event, '项目集')
  return await portfolioCall(event, 'aims.project-portfolio-delete', {
    objectId, idempotencyKey: `portfolio-delete:${objectId}`
  })
}

export async function enterpriseAimsProjectDelete(event: H3Event) {
  const projectId = requireID(event, '项目')
  return await portfolioCall(event, 'aims.project-delete', {
    projectId, idempotencyKey: `project-delete:${projectId}`
  })
}

// 项目集成员与文档仓库登记（DOC-05a）。成员关系（负责人或有效管理者）与“至少保留一名管理者”
// 由 Runtime 在事务内对锁定行复核；本层只做人员权限与输入形状检查，不接受调用方身份字段。
const memberKeys = new Set(['action', 'uid', 'relationType', 'validUntil', 'expectedRevision'])
const repoKeys = new Set(['repoPath', 'expectedRowVersion'])

function exactPayload(payload: Record<string, unknown>, keys: Set<string>, message: string) {
  if (Object.keys(payload).some(key => !keys.has(key))) throw createError({ statusCode: 400, message })
  return payload
}

function requireIntentKey(event: H3Event) {
  const key = text(getHeader(event, 'idempotency-key'))
  if (!key || key.length > 180) throw createError({ statusCode: 400, message: '缺少幂等键' })
  return key
}

export async function enterpriseAimsPortfolioMembers(event: H3Event) {
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '项目集成员查询参数无效' })
  return await portfolioCall(event, 'aims.project-portfolio-members-list', { objectId: requireID(event, '项目集') })
}

export async function enterpriseAimsPortfolioMemberSave(event: H3Event) {
  const objectId = requireID(event, '项目集')
  const payload = exactPayload(await payloadOf(event), memberKeys, '项目集成员参数无效')
  if (!['upsert', 'remove'].includes(text(payload.action)) || !text(payload.uid) || text(payload.uid).length > 64) {
    throw createError({ statusCode: 400, message: '项目集成员参数无效' })
  }
  return await portfolioCall(event, 'aims.project-portfolio-members-save', { objectId, payload, idempotencyKey: requireIntentKey(event) })
}

export async function enterpriseAimsPortfolioDocRepoSave(event: H3Event) {
  const objectId = requireID(event, '项目集')
  const payload = exactPayload(await payloadOf(event), repoKeys, '文档仓库登记参数无效')
  return await portfolioCall(event, 'aims.project-portfolio-doc-repo-save', { objectId, payload, idempotencyKey: requireIntentKey(event) })
}

// 项目集文档只读列表（DOC-05，5b-1）。不接受任何查询参数；单份文档能否查看由 Runtime 内的
// Codocs 策略判定，组内项目成员只会得到策略允许继承的 L0/L1 文档。
export async function enterpriseAimsPortfolioDocumentList(event: H3Event) {
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '项目集文档查询参数无效' })
  return await portfolioCall(event, 'aims.project-portfolio-documents-list', { objectId: requireID(event, '项目集') })
}

// 项目集文档写入（DOC-05，5b-2）：把已有 Codocs 文档或已登记文档仓库中的文件挂入项目集、建文件夹、
// 移除引用、维护访问策略。不在项目集下新建正文或上传附件。归属只取路径中的项目集。
const documentCreateKeys = new Set(['uuid', 'title', 'parentId', 'isFolder', 'docCategory', 'documentSource', 'codocsUuid', 'repoFilePath', 'repoCommitId'])
const documentPolicyKeys = new Set(['lifecycleStage', 'confidentialityLevel', 'defaultPermission', 'inheritToMemberProjects', 'expectedEtag'])
const documentUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function requireDocumentID(event: H3Event) {
  const value = text(getRouterParam(event, 'docId'))
  if (!numericID.test(value) || !Number.isSafeInteger(Number(value))) throw createError({ statusCode: 400, message: '文档标识无效' })
  return value
}

export async function enterpriseAimsPortfolioDocumentCreate(event: H3Event) {
  const objectId = requireID(event, '项目集')
  const payload = exactPayload(await payloadOf(event), documentCreateKeys, '项目集文档参数无效')
  // 引用的 uuid 由浏览器生成，同时是幂等锚点：同一次登记的重试落到同一行。
  if (!documentUuid.test(text(payload.uuid)) || !text(payload.title)) throw createError({ statusCode: 400, message: '缺少有效的文档 uuid 或标题' })
  const idempotencyKey = requireIntentKey(event)
  if (text(payload.documentSource) === 'repo') {
    // 仓库文件只能来自该项目集登记的文档仓库；提交版本在此冻结，浏览器给出的版本只用于比对。
    const members = await portfolioCall<{ data?: { docRepo?: { repoPath?: string } | null } }>(event, 'aims.project-portfolio-members-list', { objectId })
    const repoPath = text(members.data?.docRepo?.repoPath)
    const filePath = text(payload.repoFilePath)
    if (!repoPath) throw createError({ statusCode: 409, message: '请先为项目集登记文档仓库' })
    if (!filePath || filePath.length > 500) throw createError({ statusCode: 400, message: '仓库文件路径无效' })
    const selected = text(payload.repoCommitId)
    const { getGitRepositoryFile } = await import('@hzy/foundation/server/utils/gitIntegration')
    const file = await getGitRepositoryFile({ repoPath, path: filePath, commitId: selected || undefined })
    if (file.path !== filePath || !/^[A-Za-z0-9._-]{1,64}$/.test(file.commitId || '')) throw createError({ statusCode: 503, message: '仓库返回的提交版本无效' })
    if (selected && file.commitId !== selected) throw createError({ statusCode: 409, message: '仓库文档提交版本不一致' })
    payload.repoCommitId = file.commitId
  }
  return await portfolioCall(event, 'aims.project-portfolio-documents-create', { objectId, payload, idempotencyKey })
}

export async function enterpriseAimsPortfolioDocumentDelete(event: H3Event) {
  const objectId = requireID(event, '项目集')
  const subId = requireDocumentID(event)
  return await portfolioCall(event, 'aims.project-portfolio-documents-delete', { objectId, subId, idempotencyKey: `portfolio-document-delete:${objectId}:${subId}` })
}

export async function enterpriseAimsPortfolioDocumentPolicy(event: H3Event) {
  const objectId = requireID(event, '项目集')
  const subId = requireDocumentID(event)
  const payload = exactPayload(await payloadOf(event), documentPolicyKeys, '文档访问策略参数无效')
  if (Object.keys(payload).length !== documentPolicyKeys.size || typeof payload.inheritToMemberProjects !== 'boolean' || typeof payload.expectedEtag !== 'string') {
    throw createError({ statusCode: 400, message: '文档访问策略参数无效' })
  }
  return await portfolioCall(event, 'aims.project-portfolio-documents-policy', { objectId, subId, payload, idempotencyKey: requireIntentKey(event) })
}

// 打开一份项目集文档的正文（DOC-05，5c-2）。只读。
//
// 浏览器只给出项目集与引用的数字标识；文档 UUID、存储位置与正文引用全部来自 Runtime
// 在判权之后的返回，绝不接受浏览器传入。放出正文之前再向 Runtime 复核一次：
// 文档、正文版本、关系与权限都没有变化或降级才返回，否则 409。响应不含存储位置。
interface PortfolioDocumentContent {
  portfolioId: number
  document: { id: number, title: string, parentId: number | null, updatedAt: string }
  source: Record<string, unknown>
  access: { allowed?: boolean, relation?: string, permission?: string, confidentialityLevel?: string, lifecycleStage?: string }
}
const relationRank: Record<string, number> = { inherited: 1, viewer: 2, contributor: 3, manager: 4 }
const permissionRank: Record<string, number> = { view: 1, download: 2 }

function portfolioDocumentContent(response: unknown, subId: string) {
  const envelope = response as { code?: number, data?: PortfolioDocumentContent }
  const data = envelope?.data
  const uuid = data?.source?.uuid
  if (envelope?.code !== 0 || !data || String(data.document?.id) !== subId || typeof uuid !== 'string' || !documentUuid.test(uuid)
    || data.access?.allowed !== true || !relationRank[data.access.relation || ''] || !permissionRank[data.access.permission || '']) {
    throw createError({ statusCode: 503, message: '项目集文档读取响应无效' })
  }
  return { data, uuid }
}

export async function enterpriseAimsPortfolioDocumentOpen(event: H3Event) {
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '项目集文档查询参数无效' })
  const objectId = requireID(event, '项目集')
  const subId = requireDocumentID(event)
  const read = () => portfolioCall(event, 'aims.project-portfolio-documents-content', { objectId, subId })
  const first = portfolioDocumentContent(await read(), subId)
  const { withEnterpriseCodocsDocumentContent } = await import('./enterpriseCodocsDocumentContent')
  const loaded = await withEnterpriseCodocsDocumentContent(event, { success: true, data: first.data.source }, first.uuid, false, 'view', { bodyRef: 'required' })
  // Re-read before releasing any bytes.
  const current = portfolioDocumentContent(await read(), subId)
  const same = (key: string) => JSON.stringify(current.data.source[key] ?? null) === JSON.stringify(first.data.source[key] ?? null)
  if (current.uuid !== first.uuid || !['oss_path', 'updated_at', 'snapshot_generation', 'snapshot_ref', 'body_ref', 'doc_type'].every(same)) {
    throw createError({ statusCode: 409, message: '文档正文已变化，请刷新' })
  }
  if (relationRank[current.data.access.relation!]! < relationRank[first.data.access.relation!]!
    || permissionRank[current.data.access.permission!]! < permissionRank[first.data.access.permission!]!) {
    throw createError({ statusCode: 409, message: '访问权限已变化，请刷新' })
  }
  const content = (loaded.data as { content?: unknown }).content
  return {
    code: 0,
    data: {
      portfolioId: current.data.portfolioId,
      document: current.data.document,
      access: {
        relation: current.data.access.relation, permission: current.data.access.permission,
        confidentialityLevel: current.data.access.confidentialityLevel, lifecycleStage: current.data.access.lifecycleStage
      },
      content: {
        title: typeof current.data.source.title === 'string' ? current.data.source.title : '',
        content: typeof content === 'string' ? content : '',
        updatedAt: typeof current.data.source.updated_at === 'string' ? current.data.source.updated_at : ''
      }
    }
  }
}
