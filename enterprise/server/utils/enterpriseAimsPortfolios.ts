import { createError, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import {
  callEnterpriseRuntime,
  enterpriseRuntimePermitExpiresAt,
  prepareEnterpriseRuntime,
  requireEnterpriseUser
} from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { enterpriseAimsProjectScope } from './enterpriseAimsProjects'

// 项目集与项目彻底删除。
//
// 与 Aims 中间件同一套判定：
//   - 项目集写操作要求 portfolios:admin，通过后才注入
//     current_user_can_manage_portfolios=1；调用方自带的同名参数一律丢弃。
//   - 彻底删除项目要求 admin:admin（对应 Aims 的 requireAimsProjectDeleteAccess），
//     项目管理员范围由 enterpriseAimsProjectScope 服务端算出。

type PortfolioOperation =
  | 'aims.project-portfolio-list' | 'aims.project-portfolio-create'
  | 'aims.project-portfolio-update' | 'aims.project-portfolio-delete'
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

interface PortfolioCall {
  projectId?: string
  objectId?: string
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
  } else if (operation !== 'aims.project-portfolio-list') {
    action = 'edit'
    if (!authorizationResourcesAllow(authorization.resources, 'portfolios', 'admin', authorization.actionPolicies?.portfolios)) {
      throw createError({ statusCode: 403, message: '仅 AIMS 管理员可以维护项目集' })
    }
    query.current_user_can_manage_portfolios = '1'
  } else if (!authorizationResourcesAllow(authorization.resources, 'projects', 'view', authorization.actionPolicies?.projects)) {
    throw createError({ statusCode: 403, message: '无项目查看权限' })
  }

  await prepareEnterpriseRuntime(event, operation)
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  return await callEnterpriseRuntime<T>(event, operation, {
    tenant: user.tenant,
    deployment: user.deployment,
    ...(call.projectId ? { projectId: call.projectId } : {}),
    ...(call.objectId ? { objectId: call.objectId } : {}),
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
  return await portfolioCall(event, 'aims.project-portfolio-list', { query })
}

export async function enterpriseAimsPortfolioCreate(event: H3Event) {
  return await portfolioCall(event, 'aims.project-portfolio-create', { payload: await payloadOf(event) })
}

export async function enterpriseAimsPortfolioUpdate(event: H3Event) {
  const objectId = requireID(event, '项目集')
  return await portfolioCall(event, 'aims.project-portfolio-update', {
    objectId, payload: await payloadOf(event), idempotencyKey: `portfolio-update:${objectId}`
  })
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
