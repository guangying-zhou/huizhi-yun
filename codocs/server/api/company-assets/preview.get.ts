/**
 * 预览 company 资产文件内容
 * GET /api/company-assets/preview?path=codocs/company/rules/xxx.md
 *
 * - Markdown 等文本文件：返回 { content }
 * - PDF 文件：返回同源 { preview_url, file_ext: 'pdf' }；format=pdf 返回已鉴权、已记阅读记录的字节
 */
import { createRuntimeOSSClient, getFileMetadata } from '../../utils/oss'
import { setHeader } from 'h3'
import { recordCompanyAssetAccess } from '~~/server/utils/companyAssetAccessRecords'
import { requirePermission } from '~~/server/utils/checkPermission'
import { normalizeCompanyAssetOssPath } from '~~/server/utils/assetOssPath'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'company', 'view', '缺少组织资产查看权限')

  const { path: ossPath, format } = getQuery(event) as { path: string, format?: string }
  const normalizedOssPath = normalizeCompanyAssetOssPath(ossPath)

  setHeader(event, 'Cache-Control', 'no-store')

  const ext = normalizedOssPath.split('.').pop()?.toLowerCase() || ''

  if (format !== undefined && (format !== 'pdf' || ext !== 'pdf')) {
    throw createError({ statusCode: 400, message: '不支持的预览格式' })
  }

  // Use the same authenticated origin; browser canvas must not depend on bucket CORS.
  if (ext === 'pdf') {
    if (format === 'pdf') {
      let content: Buffer
      try {
        const client = await createRuntimeOSSClient({ event })
        content = (await client.get(normalizedOssPath)).content
      } catch (error) {
        const storageError = error as { status?: number, statusCode?: number, code?: string }
        if (Number(storageError.status || storageError.statusCode) === 404 || storageError.code === 'NoSuchKey') {
          throw createError({ statusCode: 404, message: '文件不存在或暂时无法访问' })
        }
        throw createError({ statusCode: 503, message: 'PDF 内容暂时无法加载，请稍后重试' })
      }
      await recordCompanyAssetAccess(event, normalizedOssPath)
      setHeader(event, 'Content-Type', 'application/pdf')
      setHeader(event, 'X-Content-Type-Options', 'nosniff')
      return content
    }
    if (!await getFileMetadata(normalizedOssPath, 'company')) {
      throw createError({ statusCode: 404, message: '文件不存在或暂时无法访问' })
    }
    const baseURL = useRuntimeConfig(event).app.baseURL.replace(/\/$/, '')
    const previewUrl = `${baseURL}/api/company-assets/preview?format=pdf&path=${encodeURIComponent(normalizedOssPath)}`
    return { code: 0, data: { preview_url: previewUrl, file_ext: 'pdf' } }
  }

  // 文本文件返回内容
  const content = await downloadDocument(normalizedOssPath, 'company')
  if (content === null) {
    throw createError({ statusCode: 404, message: '文件不存在' })
  }

  await recordCompanyAssetAccess(event, normalizedOssPath)
  return { code: 0, data: { content, file_ext: ext } }
})
