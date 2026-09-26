import { createError, getQuery, getRouterParam, setHeader, type H3Event } from 'h3'
import {
  callEnterpriseRuntime,
  enterpriseRuntimePermitExpiresAt,
  prepareEnterpriseRuntime,
  requireEnterpriseUser
} from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { enterpriseAimsProjectScope } from './enterpriseAimsProjects'

type WorkItemReadOperation = 'aims.work-item-list' | 'aims.work-item-view' | 'aims.work-item-breakdown-context'

const listQueryKeys = new Set([
  'page', 'pageSize', 'search', 'projectId', 'projectCode', 'type', 'status',
  'milestoneId', 'assigneeUid', 'reporterUid', 'priority', 'tier', 'parentId'
])
const workItemID = /^[1-9]\d*$/

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function listInput(event: H3Event) {
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(getQuery(event))) {
    if (!listQueryKeys.has(key) || Array.isArray(raw)) {
      throw createError({ statusCode: 400, message: '工作项筛选参数无效' })
    }
    const value = text(raw)
    if (!value || value.length > 200) throw createError({ statusCode: 400, message: '工作项筛选参数无效' })
    result[key] = value
  }
  return result
}

async function workItemRead(event: H3Event, operation: WorkItemReadOperation, query: Record<string, string>, itemId = '') {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseUser(event)
  const authorization = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'aims', event)
  if (!authorizationResourcesAllow(authorization.resources, 'work_items', 'view', authorization.actionPolicies?.work_items)) {
    throw createError({ statusCode: 403, message: '无工作项查看权限' })
  }
  await prepareEnterpriseRuntime(event, operation)
  const scope = await enterpriseAimsProjectScope(event, user.uid)
  const result=await callEnterpriseRuntime<{code?:number,data?:Record<string,unknown>}>(event, operation, {
    tenant: user.tenant,
    deployment: user.deployment,
    ...(itemId ? { workItemId: itemId } : {}),
    query: { ...query, ...scope },
    authorization: {
      actorUid: user.uid,
      tenant: user.tenant,
      deployment: user.deployment,
      resource: 'work_items',
      action: 'view',
      expiresAt: enterpriseRuntimePermitExpiresAt()
    }
  })
  const completion=result.data?.completion as Record<string,unknown>|undefined
  if(result.data&&!authorizationResourcesAllow(authorization.resources,'work_items','edit',authorization.actionPolicies?.work_items))result.data.stateActions=[]
  // The distribution page only offers actions the actor's own grants allow; the
  // Runtime enforces them again inside each write transaction.
  if(result.data&&operation==='aims.work-item-breakdown-context')result.data.permissions={edit:authorizationResourcesAllow(authorization.resources,'work_items','edit',authorization.actionPolicies?.work_items),confirm:authorizationResourcesAllow(authorization.resources,'work_items','confirm',authorization.actionPolicies?.work_items)}
  if(completion){
    completion.canRequest=completion.canRequest===true&&authorizationResourcesAllow(authorization.resources,'work_items','edit',authorization.actionPolicies?.work_items)
    completion.canReplay=completion.canReplay===true&&authorizationResourcesAllow(authorization.resources,'integration_operations','replay',authorization.actionPolicies?.integration_operations)
  }
  return result
}

export async function enterpriseAimsWorkItemList(event: H3Event) {
  return await workItemRead(event, 'aims.work-item-list', listInput(event))
}

export async function enterpriseAimsWorkItemView(event: H3Event) {
  const id = text(getRouterParam(event, 'id'))
  if (!workItemID.test(id) || !Number.isSafeInteger(Number(id))) throw createError({ statusCode: 400, message: '工作项标识无效' })
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '工作项详情不接受筛选参数' })
  return await workItemRead(event, 'aims.work-item-view', {}, id)
}

/** The hosted Workflow bridge uses the same object-scope read as the page. */
export async function enterpriseAimsWorkflowItem(event: H3Event, id: string) {
  if (!workItemID.test(id) || !Number.isSafeInteger(Number(id))) throw createError({ statusCode: 400, message: '工作项标识无效' })
  const result = await workItemRead(event, 'aims.work-item-view', {}, id)
  const item = result.data
  if (!item || String(item.id || '') !== id) throw createError({ statusCode: 404, message: '工作项不存在' })
  return item
}

export async function enterpriseAimsWorkItemBreakdownContext(event: H3Event) {
  const id = text(getRouterParam(event, 'id'))
  if (!workItemID.test(id) || !Number.isSafeInteger(Number(id))) throw createError({ statusCode: 400, message: '工作项标识无效' })
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: '任务分配上下文不接受筛选参数' })
  return await workItemRead(event, 'aims.work-item-breakdown-context', {}, id)
}
