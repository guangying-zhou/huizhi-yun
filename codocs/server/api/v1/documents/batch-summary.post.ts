/**
 * 批量获取文档摘要
 * POST /api/v1/documents/batch-summary
 * Body: { uuids: string[] }
 *
 * 供其他模块调用，需 Console service token
 * 单次最多 50 个 UUID
 */
export default defineEventHandler(() => {
  // UUID membership alone is not an authorization assertion. The endpoint
  // remains unavailable until each source domain has a bounded document-read
  // command that Codocs can verify.
  throw createError({
    statusCode: 503,
    statusMessage: 'scoped_document_service_contract_required',
    message: 'Batch document summaries require a source-bound scoped service contract.'
  })
})
