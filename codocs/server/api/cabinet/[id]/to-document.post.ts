/**
 * 将 Office 文件转换为 Markdown 并保存为文档
 */
import { createOSSClient, uploadDocument } from '../../../utils/oss'
import { docxToMarkdown } from '../../../utils/officeConverter'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { getCabinetFileMetadata, markCabinetFileConverted } from '~~/server/utils/cabinetRuntime'
import { createCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'

const SUPPORTED_EXTENSIONS = new Set(['doc', 'docx'])

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '文件 ID 不能为空' })
  }

  const actorUid = requireRequestUid(event)
  const body = await readBody(event)
  const customTitle = body?.title as string | undefined
  const folderId = body?.folder_id ?? null

  const file = await getCabinetFileMetadata(event, 'personal', id)
  if (file.owner_uid !== actorUid) {
    throw createError({ statusCode: 403, message: '仅文件所有者可将个人文件柜文件转为文档' })
  }

  if (!SUPPORTED_EXTENSIONS.has(file.file_ext)) {
    throw createError({ statusCode: 400, message: `不支持转换 .${file.file_ext} 格式` })
  }

  // 从 OSS 下载文件
  const client = createOSSClient()
  const result = await client.get(file.oss_path)
  const buffer = result.content as Buffer

  let markdown: string

  switch (file.file_ext) {
    case 'doc':
    case 'docx':
      markdown = await docxToMarkdown(buffer)
      break
    default:
      throw createError({ statusCode: 400, message: '不支持的文件格式' })
  }

  // 使用自定义标题或去掉文件扩展名作为文档标题
  const title = customTitle?.trim() || file.original_name.replace(/\.[^.]+$/, '')

  const doc = await createCodocsDocumentMetadata(event, {
    title,
    docType: 'private',
    ownerUid: actorUid,
    operatorUid: actorUid,
    folderId,
    contentSize: Buffer.byteLength(markdown, 'utf-8')
  })

  const docUuid = doc.uuid

  if (doc.oss_path) {
    await uploadDocument(doc.oss_path, markdown, doc.doc_type)
  }

  // 记录转存关联
  if (docUuid) {
    await markCabinetFileConverted(event, 'personal', id, docUuid)
  }

  return {
    success: true,
    data: {
      uuid: docUuid,
      title
    }
  }
})
