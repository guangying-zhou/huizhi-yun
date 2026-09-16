/**
 * 发布 PDF 到公司文档目录
 * POST /api/dept-cabinet/publish
 * Body: { fileUuid: string, targetCategory: string }
 *
 * 需要组织资产发布权限，将文件柜中的 PDF 复制到 company/{targetCategory}/ 目录
 */
import { createOSSClient } from '../../utils/oss'
import { getCabinetFileMetadata } from '~~/server/utils/cabinetRuntime'
import { requirePermission } from '~~/server/utils/checkPermission'

const VALID_CATEGORIES = new Set([
  'rules', 'notices', 'culture', 'legal',
  'tech-specs', 'knowledge', 'templates'
])

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'company', 'publish', '缺少组织资产发布权限')

  const body = await readBody(event)
  const { fileUuid, targetCategory, deptCode: bodyDeptCode, dept_code: bodyDeptCodeSnake } = body || {}

  if (!fileUuid || !targetCategory) {
    throw createError({ statusCode: 400, message: '缺少必要参数' })
  }

  if (!VALID_CATEGORIES.has(targetCategory)) {
    throw createError({ statusCode: 400, message: '无效的目标分类' })
  }

  const query = getQuery(event)
  const deptCode = String(query.dept_code || query.deptCode || bodyDeptCode || bodyDeptCodeSnake || '').trim()
  const file = await getCabinetFileMetadata(event, 'department', fileUuid, { departmentCode: deptCode })

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
