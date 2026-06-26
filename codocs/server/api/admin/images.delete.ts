/**
 * 删除 OSS 图片（支持单个和批量删除）。
 * 只允许删除无元数据、关联文档不存在或未被文档引用的图片。
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { deleteImage, deleteImages, downloadDocument, getImageMetadata } from '~~/server/utils/oss'

interface RuntimePage<T> {
  items?: T[]
}

interface DocumentRow {
  doc_type: string
  oss_path: string
}

const findDocumentByOssPath = async (event: Parameters<typeof callCodocsTenantRuntime>[0], ossPath: string) => {
  const page = await callCodocsTenantRuntime<RuntimePage<DocumentRow>>(event, '/v1/codocs/documents', {
    query: {
      oss_path: ossPath,
      limit: 1
    },
    scope: 'codocs.read'
  })
  return page.items?.[0] || null
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ paths?: string[] }>(event)
  const paths = body.paths || []
  if (!Array.isArray(paths) || paths.length === 0) {
    throw createError({ statusCode: 400, message: '请提供要删除的图片路径' })
  }

  for (const path of paths) {
    if (!path.startsWith('codocs/users/') || !path.includes('/images/')) {
      throw createError({ statusCode: 400, message: `非法路径: ${path}` })
    }
  }

  const normalPaths: string[] = []
  for (const path of paths) {
    const meta = await getImageMetadata(path)
    const rawDocPath = meta['doc-path'] || ''
    const docPath = rawDocPath ? decodeURIComponent(rawDocPath) : ''
    if (!docPath) continue

    const doc = await findDocumentByOssPath(event, docPath)
    if (!doc) continue

    try {
      const content = await downloadDocument(doc.oss_path, doc.doc_type)
      const fileName = path.split('/').pop() || ''
      if (content && fileName && content.includes(fileName)) {
        normalPaths.push(path)
      }
    } catch {
      // 无法下载内容时按孤立图片处理，保持旧行为。
    }
  }

  if (normalPaths.length > 0) {
    throw createError({
      statusCode: 400,
      message: `${normalPaths.length} 张图片状态正常（被文档引用中），不允许删除`
    })
  }

  if (paths.length === 1) {
    await deleteImage(paths[0]!)
  } else {
    await deleteImages(paths)
  }

  return {
    success: true,
    deletedCount: paths.length
  }
})
