import { readHostProjectDocumentFile } from '../../../aims/layer/server/index'
import { enterpriseAimsDocumentReadPermitProvider } from './enterpriseAimsProjectDocumentPermits'
import { createError, getRouterParam, sendRedirect, setHeader, type H3Event } from 'h3'

type Action = 'preview' | 'download'
const numericID = /^[1-9]\d*$/
function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

async function proxy(event: H3Event, action: Action) {
  setHeader(event, 'Cache-Control', 'no-store')
  const projectId = text(getRouterParam(event, 'id'))
  const documentId = text(getRouterParam(event, 'documentId'))
  if (!numericID.test(projectId) || !Number.isSafeInteger(Number(projectId)) || !numericID.test(documentId) || !Number.isSafeInteger(Number(documentId))) throw createError({ statusCode: 400, message: '项目或文档标识无效' })
  return await readHostProjectDocumentFile(event, enterpriseAimsDocumentReadPermitProvider(event), action, projectId, documentId)
}

export const enterpriseAimsProjectDocumentPreview = (event: H3Event) => proxy(event, 'preview')

export async function enterpriseAimsProjectDocumentDownload(event: H3Event) {
  const response = await proxy(event, 'download') as { code?: number, data?: { url?: unknown } }
  const url = text(response?.data?.url)
  // 与独立 Aims 一致：只 302 到 Codocs 签发的短期地址，宿主不代理文件字节。
  // 地址必须是 https 绝对地址，避免把相对路径当成宿主自身的开放重定向。
  if (response?.code !== 0 || !/^https:\/\//i.test(url)) throw createError({ statusCode: 502, message: '项目文档下载地址不可用' })
  return sendRedirect(event, url, 302)
}
