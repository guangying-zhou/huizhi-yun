/**
 * 预览 company 资产文件内容
 * GET /api/company-assets/preview?path=codocs/company/rules/xxx.md
 *
 * - Markdown 等文本文件：返回 { content }
 * - PDF 文件：返回 { preview_url, file_ext: 'pdf' }
 */
import { getSignedUrl } from '../../utils/oss'

export default defineEventHandler(async (event) => {
  const { path: ossPath } = getQuery(event) as { path: string }

  if (!ossPath || !ossPath.startsWith('codocs/company/')) {
    throw createError({ statusCode: 400, message: '无效的文件路径' })
  }

  const ext = ossPath.split('.').pop()?.toLowerCase() || ''

  // PDF 文件返回签名 URL
  if (ext === 'pdf') {
    const previewUrl = await getSignedUrl(ossPath, 3600)
    return { code: 0, data: { preview_url: previewUrl, file_ext: 'pdf' } }
  }

  // 文本文件返回内容
  const content = await downloadDocument(ossPath, 'company')
  if (content === null) {
    throw createError({ statusCode: 404, message: '文件不存在' })
  }

  return { code: 0, data: { content, file_ext: ext } }
})
