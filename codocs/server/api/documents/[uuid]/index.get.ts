/**
 * 获取单个文档 API
 * GET /api/documents/:id
 */

import { downloadDocument, getFileMetadata } from '~~/server/utils/oss'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { hasMeaningfulMarkdownContent, recoverMarkdownFromYjsSnapshot } from '~~/server/utils/yjsMarkdownRecovery'
import { getCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'
import { requireDepartmentReadAccess } from '~~/server/utils/departmentAccess'
import { recordCompanyAssetAccess } from '~~/server/utils/companyAssetAccessRecords'
import { setHeader } from 'h3'

function queryText(value: unknown) {
  return String(value || '').trim()
}

export default defineEventHandler(async (event) => {
  try {
    const uuid = getRouterParam(event, 'uuid')
    const query = getQuery(event)
    const includeDeleted = query.include_deleted === '1'
    const skipContent = query.skip_content === '1'
    const actorUid = requireRequestUid(event)
    const departmentReadDeptCode = queryText(query.dept_code || query.deptCode)

    if (!uuid) {
      throw createError({
        statusCode: 400,
        message: '文档 UUID 不能为空'
      })
    }

    if (departmentReadDeptCode) {
      await requireDepartmentReadAccess(event, actorUid, departmentReadDeptCode)
    }

    const metadataQuery: Record<string, unknown> = {
      actorUid,
      include_deleted: includeDeleted ? '1' : undefined
    }
    if (departmentReadDeptCode) {
      metadataQuery.trusted_department_read_dept_code = departmentReadDeptCode
      metadataQuery.trustedDepartmentReadDeptCode = departmentReadDeptCode
    }

    const metadata = await getCodocsDocumentMetadata(event, uuid, metadataQuery)
    const doc = {
      ...metadata,
      readonly_flag: metadata.readonly ? 1 : metadata.readonly_flag
    }

    // 检查是否有未处理的冲突（从 OSS 元数据读取）
    let hasConflict = false
    let conflictInfo = null

    if (doc.oss_path && doc.doc_type === 'project') {
      const metadata = await getFileMetadata(doc.oss_path, doc.doc_type)
      if (metadata?.meta?.['conflict-status'] === '1') {
        hasConflict = true
        conflictInfo = {
          gitlabLatestCommitId: metadata.meta['gitlab-latest-commit-id'],
          gitlabLatestSize: metadata.meta['gitlab-latest-size'],
          syncedAt: metadata.meta['synced-at']
        }
      }
    }

    // 从 OSS 获取文档内容（oss_path 始终反映文件实际位置）
    let content = ''
    if (!skipContent && doc.oss_path) {
      const downloadedContent = await downloadDocument(doc.oss_path, doc.doc_type)
      content = downloadedContent || ''
      if (!hasMeaningfulMarkdownContent(content)) {
        content = await recoverMarkdownFromYjsSnapshot(doc.oss_path, doc.doc_type)
      }
      if (doc.oss_path.startsWith('codocs/company/')) {
        if (downloadedContent === null && !hasMeaningfulMarkdownContent(content)) {
          throw createError({ statusCode: 404, message: '文件不存在' })
        }
        setHeader(event, 'Cache-Control', 'no-store')
        await recordCompanyAssetAccess(event, doc.oss_path)
      }
    }

    return {
      success: true,
      data: {
        ...doc,
        content,
        hasConflict,
        conflictInfo
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    console.error('Failed to fetch document:', error)
    throw createError({
      statusCode: error.statusCode || 500,
      message: error.message || '获取文档失败'
    })
  }
})
