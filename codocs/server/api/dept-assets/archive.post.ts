/**
 * 归档部门资产文件到 archives 目录（admin only）
 * POST /api/dept-assets/archive  { deptCode, subdir, sourcePath }
 * 移动到 codocs/archives/departments/{deptCode}/{subdir}/...
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'departments', 'admin', '仅管理员可归档文件')
  const uid = requireRequestUid(event)
  const sessionId = getCookie(event, 'token') || null

  const { deptCode, subdir, sourcePath } = await readBody(event)
  if (!deptCode || !subdir || !sourcePath) {
    throw createError({ statusCode: 400, message: '缺少参数' })
  }

  const prefix = `codocs/departments/${deptCode}/${subdir}/`
  if (!sourcePath.startsWith(prefix)) {
    throw createError({ statusCode: 400, message: '文件路径不合法' })
  }

  // 保持相对路径结构: codocs/departments/GMO/rules/a/b.md → codocs/archives/departments/GMO/rules/a/b.md
  const relativePath = sourcePath.substring('codocs/departments/'.length)
  const archivePath = `codocs/archives/departments/${relativePath}`

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
      deptCode,
      subdir,
      sourcePath,
      archivePath
    }
  })

  return { code: 0, data: { archivePath } }
})
