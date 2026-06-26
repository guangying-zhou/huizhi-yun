/**
 * 组织资产导出已禁用
 * POST /api/company-assets/export-docx
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'

export default defineEventHandler(async (event) => {
  requireRequestUid(event, '未登录')

  throw createError({ statusCode: 403, message: '组织资产仅支持在线查看，不允许导出' })
})
