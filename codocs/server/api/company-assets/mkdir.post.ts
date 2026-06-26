/**
 * 在 company 子目录下创建文件夹（admin only）
 * POST /api/company-assets/mkdir  { subdir, path, name }
 * OSS 没有真正的目录，创建一个 0 字节的占位对象
 */
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'company', 'admin', '仅管理员可创建目录')

  const { subdir, path: subPath, name } = await readBody(event)
  if (!subdir || !name) {
    throw createError({ statusCode: 400, message: '缺少参数' })
  }

  let dirPath = `codocs/company/${subdir}/`
  if (subPath) dirPath += subPath.replace(/^\/+/, '').replace(/\/$/, '') + '/'
  dirPath += name.replace(/[\\/:*?"<>|]/g, '_') + '/'

  const client = await createRuntimeOSSClient()
  await client.put(dirPath, Buffer.alloc(0))

  return { code: 0, data: { path: dirPath } }
})
