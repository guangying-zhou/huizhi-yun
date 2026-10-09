/**
 * 归档 company 资产文件到 archives 目录（admin only）
 * POST /api/company-assets/archive  { subdir, sourcePath }
 * 移动到 codocs/archives/company/{subdir}/...
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'company', 'admin', '仅管理员可归档文件')
  const uid = requireRequestUid(event)
  const sessionId = getCookie(event, 'token') || null

  const { subdir, sourcePath } = await readBody(event)
  if (!subdir || !sourcePath) {
    throw createError({ statusCode: 400, message: '缺少参数' })
  }

  const prefix = `codocs/company/${subdir}/`
  if (!sourcePath.startsWith(prefix)) {
    throw createError({ statusCode: 400, message: '文件路径不合法' })
  }

  // 保持相对路径结构: codocs/company/rules/a/b.md → codocs/archives/company/rules/a/b.md
  const relativePath = sourcePath.substring('codocs/company/'.length)
  const archivePath = `codocs/archives/company/${relativePath}`

  const client = await createRuntimeOSSClient()
  await client.copy(archivePath, sourcePath)
  await client.delete(sourcePath)

  const fileName = sourcePath.split('/').pop() || sourcePath
  await reportOperationAudit({
    sourceApp: 'codocs',
    sessionId,
    operatorUid: uid,
    action: 'document.archive',
    targetType: 'document',
    targetId: sourcePath,
    detail: {
      fileName,
      subdir,
      sourcePath,
      archivePath
    }
  })

  return { code: 0, data: { archivePath } }
})
