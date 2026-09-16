/**
 * 预览部门资产文件内容
 * GET /api/dept-assets/preview?path=codocs/departments/xxx/records/yyy.md
 */
import { requirePermission } from '~~/server/utils/checkPermission'
import { normalizeDepartmentAssetOssPath } from '~~/server/utils/assetOssPath'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'departments', 'view', '缺少部门文档查看权限')

  const { path: ossPath } = getQuery(event) as { path: string }
  const normalizedOssPath = normalizeDepartmentAssetOssPath(ossPath)

  const content = await downloadDocument(normalizedOssPath, 'department')
  if (content === null) {
    throw createError({ statusCode: 404, message: '文件不存在' })
  }

  return { code: 0, data: { content } }
})
