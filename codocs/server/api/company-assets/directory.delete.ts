/**
 * 删除 company 资产空目录（admin only）
 * DELETE /api/company-assets/directory  { subdir, dirPath }
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'

interface OSSListV2Result {
  objects?: Array<{
    name: string
    size: number
    lastModified: string
  }>
}

interface OSSClient {
  listV2(options: {
    'prefix': string
    'max-keys': number
  }): Promise<OSSListV2Result>
  delete(path: string): Promise<unknown>
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'company', 'admin', '仅管理员可删除目录')
  const uid = requireRequestUid(event)
  const sessionId = getCookie(event, 'token') || null

  const { subdir, dirPath } = await readBody(event)
  const normalizedSubdir = String(subdir || '').trim().replace(/^\/+|\/+$/g, '')
  const normalizedDirPath = String(dirPath || '').trim()

  if (!normalizedSubdir || !normalizedDirPath) {
    throw createError({ statusCode: 400, message: '缺少参数' })
  }

  const allowedPrefix = `codocs/company/${normalizedSubdir}/`
  if (
    !normalizedDirPath.startsWith(allowedPrefix)
    || !normalizedDirPath.endsWith('/')
    || normalizedDirPath === allowedPrefix
  ) {
    throw createError({ statusCode: 400, message: '目录路径不合法' })
  }

  const client = await createRuntimeOSSClient() as unknown as OSSClient
  const result = await client.listV2({
    'prefix': normalizedDirPath,
    'max-keys': 2
  })

  const nonMarkerObjects = (result.objects || []).filter(obj => obj.name !== normalizedDirPath)
  if (nonMarkerObjects.length > 0) {
    throw createError({ statusCode: 400, message: '目录非空，不能删除' })
  }

  await client.delete(normalizedDirPath)

  await reportOperationAudit({
    sourceApp: 'codocs',
    sessionId,
    operatorUid: uid,
    action: 'company_asset.directory.delete',
    targetType: 'company_asset_directory',
    targetId: normalizedDirPath,
    detail: {
      subdir: normalizedSubdir,
      dirPath: normalizedDirPath
    }
  })

  return { code: 0, data: { path: normalizedDirPath } }
})
