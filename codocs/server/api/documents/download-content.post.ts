/**
 * 下载文档内容 API
 * POST /api/documents/download-content
 *
 * 从 OSS 下载文档内容并返回，用于前端审阅页面展示文档
 */

import { downloadDocument } from '../../utils/oss'
import { hasMeaningfulMarkdownContent, recoverMarkdownFromYjsSnapshot } from '../../utils/yjsMarkdownRecovery'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { oss_path, doc_type } = body

    if (!oss_path) {
      throw createError({
        statusCode: 400,
        message: '缺少 oss_path 参数'
      })
    }

    let content = await downloadDocument(oss_path, doc_type)

    if (content === null) {
      content = await recoverMarkdownFromYjsSnapshot(oss_path, doc_type)
    } else if (!hasMeaningfulMarkdownContent(content)) {
      content = await recoverMarkdownFromYjsSnapshot(oss_path, doc_type)
    }

    if (!hasMeaningfulMarkdownContent(content)) {
      throw createError({
        statusCode: 404,
        message: '文档内容不存在'
      })
    }

    return {
      success: true,
      content
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number }
    if (error.statusCode) throw err
    console.error('Failed to download document content:', error)
    throw createError({
      statusCode: 500,
      message: '下载文档内容失败'
    })
  }
})
