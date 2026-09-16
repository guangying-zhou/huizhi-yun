import { getSignedUrl } from '../../../utils/oss'
import { getCabinetFileMetadata } from '~~/server/utils/cabinetRuntime'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'documents', 'export', '缺少文档导出权限')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '文件 ID 不能为空' })
  }

  const file = await getCabinetFileMetadata(event, 'personal', id)

  // 生成签名 URL 并重定向（response 参数需参与签名计算）
  const signedUrl = await getSignedUrl(file.oss_path, 300, {
    'content-disposition': `attachment; filename="${encodeURIComponent(file.original_name)}"`
  })

  return sendRedirect(event, signedUrl)
})
