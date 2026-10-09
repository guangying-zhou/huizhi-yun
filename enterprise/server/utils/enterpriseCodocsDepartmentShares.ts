import { createError, getHeader, getRouterParam, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, prepareEnterpriseRuntime, enterpriseRuntimePermitExpiresAt } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { departmentCabinetAuthorize, departmentCabinetQuery } from './enterpriseCodocsDepartmentCabinet'
import { sendEnterpriseCodocsNotification } from './enterpriseCodocsNotification'

const code = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/
const pagePattern = /^[1-9]\d*$/

export async function enterpriseCodocsDepartmentShares(event: H3Event, action: 'list' | 'decide') {
  setHeader(event, 'Cache-Control', 'no-store')
  const query = departmentCabinetQuery(event, action === 'list' ? ['dept_code', 'page', 'pageSize'] : ['dept_code'])
  const deptCode = query.dept_code || ''
  if (!code.test(deptCode)) throw createError({ statusCode: 400, message: '部门编码无效' })
  const page = query.page || '1', pageSize = query.pageSize || '20'
  if (action === 'list' && (!pagePattern.test(page) || !pagePattern.test(pageSize) || Number(page) > 1000000 || Number(pageSize) > 200)) throw createError({ statusCode: 400, message: '分页参数无效' })
  const id = action === 'decide' ? getRouterParam(event, 'id') || '' : ''
  if (action === 'decide' && (!pagePattern.test(id) || Number(id) > Number.MAX_SAFE_INTEGER)) throw createError({ statusCode: 400, message: '移交记录无效' })
  const user = await departmentCabinetAuthorize(event, deptCode, action === 'list' ? 'view' : 'edit', action === 'decide')
  const operation = action === 'list' ? 'codocs.department-shares-list' : 'codocs.department-shares-decide'
  await prepareEnterpriseRuntime(event, operation)
  const input: Record<string, unknown> = {
    tenant: user.tenant, deployment: user.deployment, code: deptCode,
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'department-shares', action: action === 'list' ? 'read' : 'edit', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }
  let options: { idempotencyKey: string } | undefined
  if (action === 'list') input.query = { page, pageSize }
  else {
    const key = getHeader(event, 'idempotency-key') || ''
    if (!keyPattern.test(key)) throw createError({ statusCode: 400, message: 'Idempotency-Key 无效' })
    const body = await readBody<Record<string, unknown>>(event)
    if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || (body.action !== 'accept' && body.action !== 'reject')) throw createError({ statusCode: 400, message: '移交决定请求无效' })
    input.objectId = id
    input.payload = { action: body.action }
    options = { idempotencyKey: key }
  }
  const response = await callEnterpriseRuntime(event, operation, input, options) as { success?: boolean, data?: unknown }
  if (response?.success !== true || !response.data) throw createError({ statusCode: 503, message: '部门移交响应无效' })
  if (action === 'list') {
    const data = response.data as { items?: unknown[], total?: number, page?: number, pageSize?: number }
    if (!Array.isArray(data.items) || !Number.isSafeInteger(data.total) || !Number.isSafeInteger(data.page) || !Number.isSafeInteger(data.pageSize)) throw createError({ statusCode: 503, message: '部门移交列表无效' })
    return { code: 0, data: data.items, total: data.total, page: data.page, pageSize: data.pageSize }
  }
  const result = response.data as { shareId?: number, documentUuid?: string, documentTitle?: string, senderUid?: string, departmentCode?: string, status?: string }
  if (result.shareId !== Number(id) || result.departmentCode !== deptCode || result.status !== ((input.payload as { action: string }).action === 'accept' ? 'accepted' : 'rejected') || !result.senderUid || !result.documentUuid) throw createError({ statusCode: 503, message: '部门移交决定结果无效' })
  try {
    await sendEnterpriseCodocsNotification({
      event, touser: [result.senderUid], title: result.status === 'accepted' ? '文档移交已接收' : '文档移交已拒绝',
      description: `${user.uid}${result.status === 'accepted' ? '已接收' : '已拒绝'}您的部门文档移交请求。`,
      url: `/codocs/documents/${result.documentUuid}`,
      eventType: `codocs.department_share.${result.status}`, category: 'document_share', severity: result.status === 'accepted' ? 'success' : 'warning',
      bizType: 'department_share', bizId: result.shareId, idempotencyKey: `codocs:department-share-handled:${result.shareId}:${result.status}`,
      metadata: { shareId: result.shareId, documentUuid: result.documentUuid, departmentCode: deptCode, handlerUid: user.uid, action: (input.payload as { action: string }).action }
    })
  } catch { throw createError({ statusCode: 503, message: '移交决定已保存，通知暂未完成；请使用同一请求重试' }) }
  return { code: 0, data: result }
}
