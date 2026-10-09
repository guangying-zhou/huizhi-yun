import { createOSSClient } from '../../../utils/oss'
import { getCabinetFileMetadata } from '~~/server/utils/cabinetRuntime'

const SUPPORTED_EXTENSIONS = new Set(['pptx'])

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '文件 ID 不能为空' })
  }

  const file = await getCabinetFileMetadata(event, 'personal', id)

  if (!SUPPORTED_EXTENSIONS.has(file.file_ext)) {
    throw createError({ statusCode: 400, message: `不支持预览 .${file.file_ext} 格式` })
  }

  const client = createOSSClient()
  const result = await client.get(file.oss_path)
  const buffer = result.content as Buffer

  setResponseHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  setResponseHeader(event, 'Cache-Control', 'private, max-age=300')
  return buffer
})
