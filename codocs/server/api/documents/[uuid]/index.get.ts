/**
 * 获取单个文档 API
 * GET /api/documents/:id
 */

import { downloadDocument, getFileMetadata } from '~~/server/utils/oss'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { hasMeaningfulMarkdownContent, recoverMarkdownFromYjsSnapshot } from '~~/server/utils/yjsMarkdownRecovery'
import { getCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  try {
    const uuid = getRouterParam(event, 'uuid')
    const query = getQuery(event)
    const includeDeleted = query.include_deleted === '1'
    const skipContent = query.skip_content === '1'
    const actorUid = requireRequestUid(event)

    if (!uuid) {
      throw createError({
        statusCode: 400,
        message: '文档 UUID 不能为空'
      })
    }

    const metadata = await getCodocsDocumentMetadata(event, uuid, {
      actorUid,
      include_deleted: includeDeleted ? '1' : undefined
    })
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
      content = (await downloadDocument(doc.oss_path, doc.doc_type)) || ''
      if (!hasMeaningfulMarkdownContent(content)) {
        content = await recoverMarkdownFromYjsSnapshot(doc.oss_path, doc.doc_type)
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
