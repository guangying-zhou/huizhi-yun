import { getSignedUrl } from '../../../utils/oss'
import { getCabinetFileMetadata } from '~~/server/utils/cabinetRuntime'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'departments', 'export', '缺少部门文档导出权限')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: '文件 ID 不能为空' })
  }

  const file = await getCabinetFileMetadata(event, 'department', id)

  const signedUrl = await getSignedUrl(file.oss_path, 300, {
    'content-disposition': `attachment; filename="${encodeURIComponent(file.original_name)}"`
  })

  return sendRedirect(event, signedUrl)
})
