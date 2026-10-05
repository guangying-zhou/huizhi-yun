import { isValidProjectAttachmentSize } from '../../../aims/shared/projectDocumentRules'
import { writeHostProjectDocument } from '../../../aims/layer/server/index'
import { enterpriseAimsDocumentReadPermitProvider } from './enterpriseAimsProjectDocumentPermits'
import { createError, getRouterParam, readBody, readMultipartFormData, setHeader, type H3Event } from 'h3'
import { hashServiceCommandPayload } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'

type Action = 'create-index' | 'create-markdown' | 'upload-file' | 'delete'
const numericID = /^[1-9]\d*$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

async function proxy(event: H3Event, action: Action, keys: Record<string, string>, payload?: Record<string, unknown>) {
  setHeader(event, 'Cache-Control', 'no-store')
  return await writeHostProjectDocument(event, enterpriseAimsDocumentReadPermitProvider(event), action, keys, payload)
}

export async function enterpriseAimsCreateProjectDocument(event: H3Event) {
  const body = await readBody<Record<string, unknown>>(event) || {}
  // 浏览器必须自带文档 uuid：它同时是业务主键和幂等键，服务端不代生成，
  // 否则同一次创建的重试会各得一个新 uuid 并落成重复文档。
  const documentUuid = text(body.uuid)
  if (!uuidPattern.test(documentUuid)) throw createError({ statusCode: 400, message: '缺少有效的文档 uuid' })
  const { uuid: _uuid, ...rest } = body
  return await proxy(event, 'create-index', { documentUuid }, rest)
}

export async function enterpriseAimsCreateProjectMarkdownDocument(event: H3Event) {
  const projectId = text(getRouterParam(event, 'id'))
  if (!numericID.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: '项目标识无效' })
  const body = await readBody<Record<string, unknown>>(event) || {}
  // Markdown 文档的 uuid 由 Aims 生成，这里用调用方提供的幂等键锚定重试；
  // 没有就用请求体派生一个稳定键，保证同一份内容的重试不会建出两篇。
  const documentUuid = text(body.idempotencyUuid) || text(body.uuid)
  const { idempotencyUuid: _key, ...rest } = body
  const anchor = uuidPattern.test(documentUuid) ? documentUuid : await stableUuid(projectId, rest)
  return await proxy(event, 'create-markdown', { documentUuid: anchor, projectId }, rest)
}

export async function enterpriseAimsDeleteProjectDocument(event: H3Event) {
  const documentId = text(getRouterParam(event, 'id'))
  if (!numericID.test(documentId) || !Number.isSafeInteger(Number(documentId))) throw createError({ statusCode: 400, message: '文档标识无效' })
  return await proxy(event, 'delete', { documentId })
}

export async function enterpriseAimsUploadProjectDocument(event: H3Event) {
  await requireEnterpriseUser(event)
  const projectId = text(getRouterParam(event, 'id'))
  if (!numericID.test(projectId) || !Number.isSafeInteger(Number(projectId))) throw createError({ statusCode: 400, message: '项目标识无效' })
  const parts = await readMultipartFormData(event)
  const file = parts?.find(part => part.name === 'file' && part.filename)
  const documentUuid = parts?.find(part => part.name === 'documentUuid')?.data.toString() || ''
  if (!uuidPattern.test(documentUuid)) throw createError({ statusCode: 400, message: '缺少有效的文档 uuid' })
  if (!file?.filename || !isValidProjectAttachmentSize(file.data.length)) throw createError({ statusCode: 400, message: '请选择不超过 100 MB 的文件' })
  return await proxy(event, 'upload-file', { projectId, documentUuid }, {
    fileName: file.filename, contentType: file.type || 'application/octet-stream',
    contentBase64: file.data.toString('base64'),
    docCategory: parts?.find(part => part.name === 'docCategory')?.data.toString() || ''
  })
}

// 由项目与请求体内容派生的确定性 UUID：同一份提交重试得到同一个键。
async function stableUuid(projectId: string, body: Record<string, unknown>) {
  const digest = await hashServiceCommandPayload({ projectId, body })
  const hex = digest.replace(/[^0-9a-f]/gi, '').slice(0, 32).padEnd(32, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
