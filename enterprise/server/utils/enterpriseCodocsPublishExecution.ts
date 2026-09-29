import { createHash } from 'node:crypto'
import { createError, getHeader, getRequestURL, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { sendEnterpriseCodocsNotification } from './enterpriseCodocsNotification'

type Action = 'seal' | 'send' | 'receive'
const permissions: Record<Action, string> = { seal: 'admin', send: 'archive', receive: 'view' }
const fields: Record<Action, Set<string>> = {
  seal: new Set(['sealTypes', 'pageCount', 'remark']),
  send: new Set(['senderUid', 'receiverName', 'receiverPhone', 'channel', 'sentDate', 'targetAccount', 'remark']),
  receive: new Set(['receiveDate'])
}

function text(value: unknown, max: number) {
  const result = String(value ?? '').trim()
  if ([...result].length > max || /[\u0000\r\n]/.test(result)) throw createError({ statusCode: 400, message: '发文执行字段无效' })
  return result
}

function payload(action: Action, body: Record<string, unknown>) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields[action].has(key))) throw createError({ statusCode: 400, message: '发文执行字段无效' })
  if (action === 'seal') {
    const sealTypes = Array.isArray(body.sealTypes) ? [...new Set(body.sealTypes.map(value => String(value)))].sort() : []
    if (!sealTypes.length || sealTypes.some(value => !['official', 'legal', 'finance', 'contract'].includes(value)) || !Number.isSafeInteger(body.pageCount) || Number(body.pageCount) < 1) throw createError({ statusCode: 400, message: '盖章信息无效' })
    return { sealTypes, pageCount: body.pageCount, remark: text(body.remark, 500) || null }
  }
  if (action === 'send') {
    const result = { senderUid: text(body.senderUid, 64), receiverName: text(body.receiverName, 100), receiverPhone: text(body.receiverPhone, 30), channel: text(body.channel, 30), sentDate: text(body.sentDate, 10), targetAccount: text(body.targetAccount, 200) || null, remark: text(body.remark, 500) || null }
    if (!result.senderUid || !result.receiverName || !result.receiverPhone || !['email', 'wecom', 'wechat_qq', 'web_upload', 'sf_express', 'other_courier', 'other_method', 'usb'].includes(result.channel) || !/^\d{4}-\d{2}-\d{2}$/.test(result.sentDate)) throw createError({ statusCode: 400, message: '发送信息无效' })
    return result
  }
  const receiveDate = text(body.receiveDate, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receiveDate)) throw createError({ statusCode: 400, message: '接收日期无效' })
  return { receiveDate }
}

async function notify(event: H3Event, action: Action, id: string, result: { initiatorUid?: string, senderUid?: string, documentTitle?: string }) {
  const title = result.documentTitle || '文档'
  const recipients = [result.initiatorUid].filter(Boolean) as string[]
  if (!recipients.length) throw createError({ statusCode: 503, message: '发文执行通知缺少接收人' })
  const labels = { seal: ['对外发文盖章完成', `对外发文《${title}》已完成盖章，请继续确认发送。`], send: ['对外发文发送登记完成', `对外发文《${title}》已完成发送登记，待确认对方接收。`], receive: ['对外发文接收确认完成', `对外发文《${title}》已确认对方接收。`] } as const
  await sendEnterpriseCodocsNotification({ event, touser: recipients, title: labels[action][0], description: labels[action][1], url: '/codocs/mydocs/shared', eventType: `codocs.review.${action}_confirmed`, category: 'document_review', severity: 'success', bizType: 'document_review', bizId: id, idempotencyKey: `codocs:publish-${action}:${createHash('sha256').update(id).digest('hex')}`, metadata: { reviewId: Number(id), action } })
  if (action === 'send' && result.senderUid && result.senderUid !== result.initiatorUid) {
    await sendEnterpriseCodocsNotification({ event, touser: [result.senderUid], title: '待确认对外发文接收', description: `对外发文《${title}》已登记发送，请跟进并确认对方接收。`, url: '/codocs/mydocs/shared', eventType: 'codocs.review.receive_pending', category: 'document_review', severity: 'info', bizType: 'document_review', bizId: id, idempotencyKey: `codocs:publish-receive-pending:${createHash('sha256').update(id).digest('hex')}`, metadata: { reviewId: Number(id), action: 'receive_pending' } })
  }
}

export async function enterpriseCodocsPublishExecution(event: H3Event, action: Action) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (getRequestURL(event).search) throw createError({ statusCode: 400, message: '发文执行不接受查询参数' })
  const id = String(getRouterParam(event, 'id') || '')
  if (!/^[1-9]\d{0,18}$/.test(id)) throw createError({ statusCode: 400, message: '发布申请 ID 无效' })
  const key = getHeader(event, 'idempotency-key') || ''
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/.test(key)) throw createError({ statusCode: 400, message: '发文执行需要有效的 Idempotency-Key' })
  const user = await requireEnterpriseUser(event)
  const operation = `codocs.publish-execution-${action}` as const
  await prepareEnterpriseRuntime(event, operation)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'reviews', permissions[action], snapshot.actionPolicies?.reviews)) throw createError({ statusCode: 403, message: '缺少发文执行权限' })
  const input = payload(action, await readBody<Record<string, unknown>>(event))
  const response = await callEnterpriseRuntime<{ success?: boolean, data?: { initiatorUid?: string, senderUid?: string, documentTitle?: string, executionStatus?: string, idempotent?: boolean } }>(event, operation, {
    tenant: user.tenant, deployment: user.deployment, code: id, payload: input,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'publish-execution', action, expiresAt: enterpriseRuntimePermitExpiresAt() }
  }, { idempotencyKey: key })
  if (response?.success !== true || !response.data || typeof response.data.executionStatus !== 'string' || typeof response.data.initiatorUid !== 'string' || typeof response.data.documentTitle !== 'string') throw createError({ statusCode: 503, message: '发文执行响应无效' })
  try {
    await notify(event, action, id, response.data)
  } catch {
    throw createError({ statusCode: 503, message: '发文状态已保存，通知尚未完成，请使用相同请求重试' })
  }
  return { code: 0, message: 'success', data: response.data }
}
