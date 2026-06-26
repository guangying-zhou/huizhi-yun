/**
 * 导出部门对外发文为 DOCX
 * POST /api/dept-assets/export-docx
 */
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { markdownToDocx } from '~~/server/utils/markdownToDocx'
import { downloadDocument } from '~~/server/utils/oss'
import { requirePermission } from '~~/server/utils/checkPermission'

interface PublishRecord {
  extra?: string | Record<string, unknown> | null
}

function parseExtra(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
    } catch {
      return null
    }
  }
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
}

export default defineEventHandler(async (event) => {
  requireRequestUid(event, '未登录')
  await requirePermission(event, 'departments', 'export', '缺少部门文档导出权限')

  const body = await readBody<{ path?: string, filename?: string }>(event)
  const ossPath = String(body?.path || '').trim()
  const filename = String(body?.filename || '').trim()

  if (!ossPath || !ossPath.startsWith('codocs/departments/') || !ossPath.includes('/outsides/')) {
    throw createError({ statusCode: 400, message: '仅对外发文支持 DOCX 导出' })
  }

  const review = await callCodocsTenantRuntime<PublishRecord | null>(event, '/v1/codocs/reviews/by-oss-path', {
    query: { path: ossPath },
    scope: 'codocs.read'
  })
  if (!review) {
    throw createError({ statusCode: 403, message: '未找到发布记录，暂不允许导出 DOCX' })
  }

  const extra = parseExtra(review.extra)
  if (String(extra?.outsideFileLevel || 'general') !== 'general') {
    throw createError({ statusCode: 403, message: '重要文件和关键文件仅支持导出 PDF' })
  }

  const content = await downloadDocument(ossPath)
  if (content === null) {
    throw createError({ statusCode: 404, message: '文件不存在' })
  }

  const baseName = (filename || ossPath.split('/').pop() || 'document').replace(/\.md$/i, '')
  try {
    const buffer = await markdownToDocx(content, baseName)
    const encodedName = encodeURIComponent(baseName + '.docx')
    setResponseHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    setResponseHeader(event, 'Content-Disposition', `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`)
    return buffer
  } catch (error) {
    console.error('[DeptExportDocx] Failed:', error)
    throw createError({ statusCode: 500, message: '生成 DOCX 失败' })
  }
})
