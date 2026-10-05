import { createHash } from 'node:crypto'
import { createError, getHeader, getRequestURL, readMultipartFormData, setHeader, type H3Event } from 'h3'
import { reportOperationAudit } from '@hzy/foundation/server/utils/accountApi'
import { createEnterpriseCodocsDocument, requireEnterpriseCodocsCreation } from './enterpriseCodocsDocumentCreation'

export async function enterpriseCodocsDocumentUpload(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const user = await requireEnterpriseCodocsCreation(event)
  if (getRequestURL(event).search) throw createError({ statusCode: 400, message: '上传不接受查询参数' })
  const key = getHeader(event, 'idempotency-key') || ''
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/.test(key)) throw createError({ statusCode: 400, message: '上传需要有效的 Idempotency-Key' })
  const parts = await readMultipartFormData(event)
  if (!parts?.length) throw createError({ statusCode: 400, message: '没有上传文件' })
  const fields: Record<string, string> = {}
  const files = []
  for (const part of parts) {
    if (part.filename !== undefined) {
      if (part.name !== 'files') throw createError({ statusCode: 400, message: '文件字段无效' })
      files.push(part)
    } else {
      if (!part.name || !['doc_type', 'folder_id', 'owner_uid'].includes(part.name) || part.name in fields) throw createError({ statusCode: 400, message: '上传字段无效' })
      fields[part.name] = part.data.toString('utf8')
    }
  }
  if (fields.owner_uid !== undefined && fields.owner_uid !== user.uid) throw createError({ statusCode: 403, message: '不能为其他用户上传私人文档' })
  const kind = fields.doc_type || 'private'
  if (!['private', 'slide'].includes(kind)) throw createError({ statusCode: 400, message: '文档类型无效' })
  const rawFolder = fields.folder_id
  const folder = !rawFolder || rawFolder === 'null' ? null : Number(rawFolder)
  if (folder !== null && (!/^[1-9]\d*$/.test(rawFolder!) || !Number.isSafeInteger(folder))) throw createError({ statusCode: 400, message: '目录标识无效' })
  if (!files.length || files.length > 30 || parts.reduce((sum, part) => sum + part.data.length, 0) > 30 * 1024 * 1024) throw createError({ statusCode: 413, message: '每批最多 30 个文件、总计 30 MiB' })
  const results = { success: 0, failed: 0, items: [] as Array<{ filename: string, status: 'success' | 'error', id?: number, uuid?: string, message?: string }> }
  for (const [index, file] of files.entries()) {
    const filename = file.filename || ''
    // Stable position inside the retained batch key; changed bytes/metadata use
    // the same identity and are rejected by the Runtime command digest.
    const itemKey = `codocs:upload:${createHash('sha256').update(JSON.stringify([user.tenant, user.deployment, user.uid, key, index])).digest('hex')}`
    try {
      if (!filename.toLowerCase().endsWith('.md') || /[\\/\x00-\x1f\x7f]/.test(filename)) throw createError({ statusCode: 400, message: '请选择有效的 .md 文件' })
      if (file.data.length > 10 * 1024 * 1024) throw createError({ statusCode: 413, message: '单个文档超过 10 MiB' })
      let content: string
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(file.data) }
      catch { throw createError({ statusCode: 400, message: '文件必须使用 UTF-8 编码' }) }
      const title = filename.replace(/\.md$/i, '')
      const result = await createEnterpriseCodocsDocument(event, async () => ({ title, doc_type: kind, folder_id: folder, content }), itemKey)
      await reportOperationAudit({ sourceApp: 'enterprise', operatorUid: user.uid, action: 'codocs.document.upload', targetType: 'document', targetId: result.data?.id, detail: { uuid: result.data?.uuid, title, logicalModule: 'codocs', docType: kind, folderId: folder } }, { event, idempotencyKey: `${itemKey}:audit` })
      results.success++
      results.items.push({ filename, status: 'success', id: result.data?.id, uuid: result.data?.uuid })
    } catch (error) {
      const status = (error as { statusCode?: number })?.statusCode
      if (status === 401 || status === 403) throw createError({ statusCode: status, message: '文档上传授权已失效' })
      results.failed++
      results.items.push({ filename, status: 'error', message: status === 409 ? '文档已存在或请求内容冲突' : status === 400 || status === 413 ? '文件名称、编码或大小无效' : '上传暂未完成，请使用相同文件重试' })
    }
  }
  return results
}
