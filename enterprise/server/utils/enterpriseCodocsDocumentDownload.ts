import { createError, getRequestURL, getRouterParam, setHeader, type H3Event } from 'h3'
import { enterpriseCodocsDocumentRead } from './enterpriseCodocsDocumentReads'
import { withEnterpriseCodocsDocumentContent } from './enterpriseCodocsDocumentContent'

export async function enterpriseCodocsDocumentDownload(event: H3Event) {
  if (getRequestURL(event).search) throw createError({ statusCode: 400, message: '下载不接受额外查询参数' })
  const uuid = getRouterParam(event, 'uuid') || ''
  const metadata = await enterpriseCodocsDocumentRead(event, 'download')
  const result = await withEnterpriseCodocsDocumentContent(event, metadata, uuid, false, 'export')
  const doc = result.data as Record<string, unknown>
  if (!doc.oss_path) throw createError({ statusCode: 404, message: '文档正文不存在' })
  let name = String(doc.title || uuid).replace(/[\r\n\\/]/g, '_')
  if (!name.toLowerCase().endsWith('.md')) name += '.md'
  const encoded = encodeURIComponent(name).replace(/['()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
  setHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`)
  return Buffer.from(String(doc.content || ''), 'utf8')
}
