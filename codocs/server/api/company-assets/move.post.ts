/**
 * 移动 company 资产文件（同类别内移动，admin only）
 * POST /api/company-assets/move  { subdir, sourcePath, targetDir }
 */
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'company', 'admin', '仅管理员可移动文件')

  const { subdir, sourcePath, targetDir } = await readBody(event)
  if (!subdir || !sourcePath) {
    throw createError({ statusCode: 400, message: '缺少参数' })
  }

  const prefix = `codocs/company/${subdir}/`
  if (!sourcePath.startsWith(prefix)) {
    throw createError({ statusCode: 400, message: '只能在同类别内移动' })
  }

  // 目标路径
  const fileName = sourcePath.split('/').pop()!
  let newPath = prefix
  if (targetDir)
    newPath += targetDir.replace(/^\/+/, '').replace(/\/$/, '') + '/'
  newPath += fileName

  if (sourcePath === newPath) return { code: 0 }

  const client = await createRuntimeOSSClient()
  await client.copy(newPath, sourcePath)
  await client.delete(sourcePath)

  return { code: 0, data: { newPath } }
})
