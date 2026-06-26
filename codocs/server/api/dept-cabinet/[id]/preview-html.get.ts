import { createOSSClient } from '../../../utils/oss'
import { docxToHtml } from '../../../utils/officeConverter'
import { getCabinetFileMetadata } from '~~/server/utils/cabinetRuntime'

const SUPPORTED_EXTENSIONS = new Set(['doc', 'docx'])

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '文件 ID 不能为空' })
  }

  const file = await getCabinetFileMetadata(event, 'department', id)

  if (!SUPPORTED_EXTENSIONS.has(file.file_ext)) {
    throw createError({ statusCode: 400, message: `不支持预览 .${file.file_ext} 格式` })
  }

  const client = createOSSClient()
  const result = await client.get(file.oss_path)
  const buffer = result.content as Buffer

  let html: string

  switch (file.file_ext) {
    case 'doc':
    case 'docx':
      html = await docxToHtml(buffer)
      break
    default:
      throw createError({ statusCode: 400, message: '不支持的文件格式' })
  }

  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  return html
})
