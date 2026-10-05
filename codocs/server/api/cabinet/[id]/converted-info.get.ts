/**
 * 获取文件柜文件转存后的文档信息（标题、路径）
 */
import { getCabinetFileMetadata } from '~~/server/utils/cabinetRuntime'
import { getCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '文件 ID 不能为空' })
  }

  const file = await getCabinetFileMetadata(event, 'personal', id)

  if (!file || !file.converted_doc_uuid) {
    return { success: true, data: null }
  }

  try {
    const doc = await getCodocsDocumentMetadata(event, file.converted_doc_uuid)
    if (doc.status === 0) {
      return { success: true, data: null }
    }
    return {
      success: true,
      data: {
        doc_uuid: doc.uuid,
        doc_title: doc.title,
        doc_path: '我的文档/' + doc.title + '.md'
      }
    }
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error) {
      return { success: true, data: null }
    }
    throw error
  }
})
