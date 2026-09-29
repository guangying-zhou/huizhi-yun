import { createError, type H3Event } from 'h3'
import { enterpriseCodocsDocumentViewByUuid } from './enterpriseCodocsDocumentReads'

// Check the actor's current Codocs ACL on every attempt, including receipt replay.
export async function requireDeliverableDocumentAccess(event: H3Event, payload: Record<string, unknown>) {
  const source = payload.documentSource ?? payload.document_source
  if (source === 'repo') return
  const raw = payload.documentUuid ?? payload.document_uuid
  if (raw === undefined || raw === null || raw === '') return
  if (typeof raw !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(raw)) {
    throw createError({ statusCode: 400, message: '文档标识无效' })
  }
  try {
    await enterpriseCodocsDocumentViewByUuid(event, raw, true)
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode
    if (status === 401 || status === 403 || status === 404) throw error
    throw createError({ statusCode: 503, message: '文档访问校验暂不可用' })
  }
}
