/**
 * 发布 PDF 到公司文档目录
 * POST /api/dept-cabinet/publish
 * Body: { fileUuid: string, targetCategory: string }
 *
 * 仅系统管理员可操作，将文件柜中的 PDF 复制到 company/{targetCategory}/ 目录
 */
import { createOSSClient } from '../../utils/oss'
import { getCabinetFileMetadata } from '~~/server/utils/cabinetRuntime'

const VALID_CATEGORIES = new Set([
  'rules', 'notices', 'culture', 'legal',
  'tech-specs', 'knowledge', 'templates'
])

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { fileUuid, targetCategory } = body || {}

  if (!fileUuid || !targetCategory) {
    throw createError({ statusCode: 400, message: '缺少必要参数' })
  }

  if (!VALID_CATEGORIES.has(targetCategory)) {
    throw createError({ statusCode: 400, message: '无效的目标分类' })
  }

  const file = await getCabinetFileMetadata(event, 'department', fileUuid)

  if (file.file_ext !== 'pdf') {
    throw createError({ statusCode: 400, message: '仅支持发布 PDF 文件' })
  }

  // OSS 复制
  const client = createOSSClient()
  const targetPath = `codocs/company/${targetCategory}/${file.original_name}`

  try {
    await client.copy(targetPath, file.oss_path)
  } catch (err: unknown) {
    console.error('[Publish] OSS copy failed:', err)
    throw createError({ statusCode: 500, message: '文件发布失败' })
  }

  return { success: true, data: { targetPath } }
})
