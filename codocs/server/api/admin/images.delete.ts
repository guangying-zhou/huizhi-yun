/**
 * 删除 OSS 图片（支持单个和批量删除）。
 * 只允许删除无元数据、关联文档不存在或未被文档引用的图片。
 */
import { findImageOwnerDocument, readImageOwnerDocumentContent } from '~~/server/utils/adminImageDocuments'
import { isSnapshotV2Document } from '~~/server/utils/documentBodyRef'
import { deleteImage, deleteImages, getImageMetadata } from '~~/server/utils/oss'
import { requirePermission } from '~~/server/utils/checkPermission'
import { normalizeCodocsUserImageObjectPath } from '~~/server/utils/ossImagePath'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin', 'admin', '仅管理员可清理图片')

  const body = await readBody<{ paths?: string[] }>(event)
  const paths = body.paths || []
  if (!Array.isArray(paths) || paths.length === 0) {
    throw createError({ statusCode: 400, message: '请提供要删除的图片路径' })
  }

  const normalizedPaths = paths.map(path => normalizeCodocsUserImageObjectPath(path))

  const normalPaths: string[] = []
  for (const path of normalizedPaths) {
    const meta = await getImageMetadata(path)
    const rawDocPath = meta['doc-path'] || ''
    const docPath = rawDocPath ? decodeURIComponent(rawDocPath) : ''
    if (!docPath) continue

    const doc = await findImageOwnerDocument(event, docPath)
    if (!doc) continue

    try {
      const content = await readImageOwnerDocumentContent(event, doc)
      const fileName = path.split('/').pop() || ''
      if (content && fileName && content.includes(fileName)) {
        normalPaths.push(path)
      }
    } catch (error) {
      // v1 无法下载内容时按孤立图片处理，保持旧行为；v2 无法确认引用关系时失败关闭，绝不删除。
      if (isSnapshotV2Document(doc)) {
        console.error('[AdminImages] Cannot verify snapshot body, refusing to delete:', error)
        throw createError({ statusCode: 503, message: '无法读取协作文档的当前正文，已拒绝删除图片，请稍后重试' })
      }
    }
  }

  if (normalPaths.length > 0) {
    throw createError({
      statusCode: 400,
      message: `${normalPaths.length} 张图片状态正常（被文档引用中），不允许删除`
    })
  }

  if (normalizedPaths.length === 1) {
    await deleteImage(normalizedPaths[0]!)
  } else {
    await deleteImages(normalizedPaths)
  }

  return {
    success: true,
    deletedCount: normalizedPaths.length
  }
})
