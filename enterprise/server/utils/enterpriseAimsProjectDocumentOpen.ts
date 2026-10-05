import { createError, getRouterParam, type H3Event } from 'h3'
import { enterpriseCodocsDocumentViewByUuid } from './enterpriseCodocsDocumentReads'

type Row = Record<string, unknown>
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function projectDocument(response: unknown, documentId: string) {
  const envelope = response as { code?: number, data?: Row }
  const row = envelope?.data
  if (envelope?.code !== 0 || !row || String(row.id) !== documentId) throw createError({ statusCode: 503, message: '项目文档元数据响应无效' })
  if ((row.documentSource ?? row.document_source) !== 'codocs') throw createError({ statusCode: 409, message: '当前文档没有可验证的 Codocs 内容绑定' })
  const uuid = row.codocsUuid ?? row.codocs_uuid
  if (typeof uuid !== 'string' || !uuidPattern.test(uuid) || uuid === '00000000-0000-0000-0000-000000000000') throw createError({ statusCode: 503, message: '项目文档正文绑定无效' })
  return { row, uuid }
}

function codocsDocument(response: unknown, uuid: string) {
  const envelope = response as { success?: boolean, data?: Row }
  if (envelope?.success !== true || !envelope.data || envelope.data.uuid !== uuid || typeof envelope.data.oss_path !== 'string' || typeof envelope.data.updated_at !== 'string') throw createError({ statusCode: 503, message: '文档正文响应无效' })
  return envelope.data
}

export async function openEnterpriseProjectDocument(event: H3Event, readProjectDocument: () => Promise<unknown>) {
  const documentId = getRouterParam(event, 'documentId') || ''
  const project = projectDocument(await readProjectDocument(), documentId)
  const doc = codocsDocument(await enterpriseCodocsDocumentViewByUuid(event, project.uuid), project.uuid)
  const currentProject = projectDocument(await readProjectDocument(), documentId)
  if (currentProject.uuid !== project.uuid) throw createError({ statusCode: 409, message: '项目文档关联已变化，请刷新' })
  // Re-read the native actor-bound metadata/ACL before releasing any bytes.
  const current = codocsDocument(await enterpriseCodocsDocumentViewByUuid(event, project.uuid, true), project.uuid)
  if (current.oss_path !== doc.oss_path || current.updated_at !== doc.updated_at) throw createError({ statusCode: 409, message: '文档正文已变化，请刷新' })
  return { code: 0, data: { document: currentProject.row, content: {
    uuid: project.uuid, title: doc.title || '', doc_type: doc.doc_type || '',
    owner_uid: doc.owner_uid || '', content: doc.content || '', updated_at: doc.updated_at || ''
  } } }
}
