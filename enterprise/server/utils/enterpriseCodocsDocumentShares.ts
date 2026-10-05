import { createError, getHeader, getRequestURL, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { getConsoleDirectoryUsersBatch } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { sendEnterpriseCodocsNotification } from './enterpriseCodocsNotification'

type Action = 'list' | 'mark-read' | 'create' | 'update' | 'delete'
const permits = { 'list': 'read', 'mark-read': 'mark-read', 'create': 'create', 'update': 'edit', 'delete': 'delete' } as const

function segment(value: unknown, label: string, numeric = false) {
  const result = String(value || '')
  const valid = numeric ? /^[1-9]\d{0,18}$/.test(result) : /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(result)
  if (!valid) throw createError({ statusCode: 400, message: `${label}无效` })
  return result
}

function cleanText(value: unknown, max: number, optional = false) {
  if (value == null && optional) return null
  if (typeof value !== 'string') throw createError({ statusCode: 400, message: '文档共享字段无效' })
  const result = value.trim()
  if ((!optional && !result) || [...result].length > max || /[\u0000\r]/.test(result)) throw createError({ statusCode: 400, message: '文档共享字段无效' })
  return result || null
}

function mutationPayload(action: Action, body: Record<string, unknown> | undefined) {
  if (action === 'delete') {
    if (body !== undefined) throw createError({ statusCode: 400, message: '取消共享不接受请求体' })
    return {}
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, message: '文档共享字段无效' })
  const allowed = action === 'create' ? new Set(['sharedToUid', 'uid', 'permission', 'message', 'ownerName']) : new Set(['permission'])
  if (Object.keys(body).some(key => !allowed.has(key))) throw createError({ statusCode: 400, message: '文档共享字段无效' })
  const permission = cleanText(body.permission, 5)
  if (permission !== 'read' && permission !== 'write') throw createError({ statusCode: 400, message: '共享权限无效' })
  if (action === 'update') return { permission }
  const target = cleanText(body.sharedToUid ?? body.uid, 64)
  if (body.sharedToUid != null && body.uid != null && body.sharedToUid !== body.uid) throw createError({ statusCode: 400, message: '共享用户无效' })
  return { sharedToUid: target, permission, message: cleanText(body.message, 500, true) }
}

function envelopeData(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return []
  const outer = value as { data?: unknown }
  if (Array.isArray(outer.data)) return outer.data
  if (outer.data && typeof outer.data === 'object' && Array.isArray((outer.data as { items?: unknown }).items)) return (outer.data as { items: unknown[] }).items
  return []
}

export async function enterpriseCodocsDocumentShares(event: H3Event, action: Action) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (getRequestURL(event).search) throw createError({ statusCode: 400, message: '文档共享不接受查询参数' })
  const uuid = segment(getRouterParam(event, 'uuid'), '文档标识')
  const shareId = action === 'update' || action === 'delete' ? segment(getRouterParam(event, 'shareId'), '共享标识', true) : ''
  const user = await requireEnterpriseUser(event)
  const operation = `codocs.document-share-${action}` as const
  await prepareEnterpriseRuntime(event, operation)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  const businessAction = action === 'mark-read' ? 'view' : 'edit'
  if (!authorizationResourcesAllow(snapshot.resources, 'documents', businessAction, snapshot.actionPolicies?.documents)) throw createError({ statusCode: 403, message: action === 'mark-read' ? '缺少文档阅读权限' : '缺少文档共享管理权限' })
  let payload: Record<string, unknown> | undefined
  let idempotencyKey: string | undefined
  if (action !== 'list') {
    idempotencyKey = getHeader(event, 'idempotency-key') || ''
    if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/.test(idempotencyKey)) throw createError({ statusCode: 400, message: '文档共享操作需要有效的 Idempotency-Key' })
    payload = action === 'mark-read' ? undefined : mutationPayload(action, await readBody<Record<string, unknown>>(event))
  }
  const response = await callEnterpriseRuntime<{ success?: boolean, data?: { items?: Array<Record<string, unknown>>, shareId?: number | string, documentTitle?: string, ownerUid?: string, targetUid?: string, permission?: string } & Record<string, unknown> }>(event, operation, {
    tenant: user.tenant, deployment: user.deployment, code: shareId ? `${uuid}/${shareId}` : uuid, ...(payload ? { payload } : {}),
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'document-shares', action: permits[action], expiresAt: enterpriseRuntimePermitExpiresAt() }
  }, idempotencyKey ? { idempotencyKey } : undefined)
  if (response?.success !== true || !response.data || typeof response.data !== 'object') throw createError({ statusCode: 503, message: '文档共享响应无效' })
  if (action === 'create') {
    const shareId = String(response.data.shareId || ''), targetUid = String(response.data.targetUid || ''), title = String(response.data.documentTitle || '')
    if (!/^[1-9]\d*$/.test(shareId) || !targetUid || !title || !['read', 'write'].includes(String(response.data.permission || ''))) throw createError({ statusCode: 503, message: '文档共享响应无效' })
    try {
      await sendEnterpriseCodocsNotification({ event, touser: [targetUid], title: '文档共享通知', description: response.data.permission === 'write' ? `您已被邀请协同编辑文档《${title}》。` : `文档《${title}》已共享给您，请查阅。`, url: `/codocs/documents/${uuid}`, eventType: 'codocs.document.shared', category: 'document_share', severity: 'info', bizType: 'document_share', bizId: shareId, idempotencyKey: `codocs:document-shared:${shareId}:${response.data.permission}`, metadata: { shareId, documentUuid: uuid, ownerUid: response.data.ownerUid, targetUid, permission: response.data.permission } })
    } catch { throw createError({ statusCode: 503, message: '共享已保存，通知尚未完成，请使用相同请求重试' }) }
  }
  if (action !== 'list') return { success: true, code: 0, message: 'success', data: response.data }
  const items = Array.isArray(response.data.items) ? response.data.items : []
  const uids = [...new Set(items.map(item => String(item.shared_to_uid || '')).filter(Boolean))]
  const names = new Map<string, { realName?: string, deptName?: string }>()
  if (uids.length) {
    try {
      for (const raw of envelopeData(await getConsoleDirectoryUsersBatch(event, uids))) {
        if (!raw || typeof raw !== 'object') continue
        const row = raw as { uid?: unknown, realName?: unknown, deptName?: unknown }
        const uid = String(row.uid || '')
        if (uid) names.set(uid, { realName: typeof row.realName === 'string' ? row.realName : undefined, deptName: typeof row.deptName === 'string' ? row.deptName : undefined })
      }
    } catch { /* Directory enrichment is non-authoritative; keep uid fallback. */ }
  }
  return {
    code: 0,
    message: 'success',
    data: items.map((item) => {
      const uid = String(item.shared_to_uid || '')
      const info = names.get(uid)
      return { ...item, real_name: info?.realName || uid, department_name: info?.deptName || '' }
    })
  }
}
