/**
 * 搜索文档
 * GET /api/v1/documents/search
 *
 * 供其他模块调用，需 Console service token
 * 支持按关键词、文档类型、项目编码、部门、所有者等条件搜索
 */
export default defineEventHandler(() => {
  // A generic service token has no project/document assertion. Do not turn
  // browser- or caller-supplied filters into a cross-project document index.
  throw createError({
    statusCode: 503,
    statusMessage: 'scoped_document_service_contract_required',
    message: 'Document search requires a source-bound scoped service contract.'
  })
})
