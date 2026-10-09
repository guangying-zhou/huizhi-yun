import { readProjectDocumentAccessPolicy, checkProjectDocumentAccess, listProjectDocumentAccessAudit, updateProjectDocumentAccessPolicy, normalizeDocumentAccessAction, type AccessPolicyBody } from '../../../aims/layer/server/index'
import { enterpriseAimsDocumentReadPermitProvider } from './enterpriseAimsProjectDocumentPermits'
import { createError, getQuery, getRouterParam, readBody, setHeader, type H3Event } from 'h3'

type Action = 'policy-read' | 'check' | 'audit' | 'policy-update'
const numericID = /^[1-9]\d*$/

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function ids(event: H3Event) {
  const projectId = text(getRouterParam(event, 'id'))
  const documentId = text(getRouterParam(event, 'documentId'))
  if (!numericID.test(projectId) || !Number.isSafeInteger(Number(projectId)) || !numericID.test(documentId) || !Number.isSafeInteger(Number(documentId))) {
    throw createError({ statusCode: 400, message: '项目或文档标识无效' })
  }
  return { projectId, documentId }
}

async function proxy(event: H3Event, action: Action, payload?: Record<string, unknown>) {
  setHeader(event, 'Cache-Control', 'no-store')
  const { projectId, documentId } = ids(event)
  const provider = enterpriseAimsDocumentReadPermitProvider(event)
  if (action === 'policy-read') return await readProjectDocumentAccessPolicy(event, provider, Number(projectId), Number(documentId))
  if (action === 'check') return await checkProjectDocumentAccess(event, provider, Number(projectId), Number(documentId), normalizeDocumentAccessAction(payload?.action))
  if (action === 'audit') return await listProjectDocumentAccessAudit(event, provider, Number(projectId), Number(documentId), Number(payload?.page) || 1, Number(payload?.pageSize) || 20)
  return await updateProjectDocumentAccessPolicy(event, provider, Number(projectId), Number(documentId), payload as unknown as AccessPolicyBody)
}

export function enterpriseAimsReadDocumentAccessPolicy(event: H3Event) {
  return proxy(event, 'policy-read')
}

export async function enterpriseAimsCheckDocumentAccess(event: H3Event) {
  const body = await readBody<{ action?: unknown }>(event) || {}
  return await proxy(event, 'check', { action: text(body.action) || 'view' })
}

export function enterpriseAimsListDocumentAccessAudit(event: H3Event) {
  const query = getQuery(event)
  return proxy(event, 'audit', { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20 })
}

export async function enterpriseAimsUpdateDocumentAccessPolicy(event: H3Event) {
  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw createError({ statusCode: 400, message: '缺少访问策略请求体' })
  return await proxy(event, 'policy-update', body)
}
