/**
 * 提交文档审阅
 * POST /api/reviews
 *
 * 该旧接口原先直接写 Codocs DB。审阅发起的完整 tenant-runtime 合同尚未落地，
 * 所以在 Codocs server 侧显式拒绝，避免绕过 runtime。
 */
export default defineEventHandler(() => {
  throw createError({
    statusCode: 503,
    message: 'Codocs tenant-runtime contract is required for review submission.'
  })
})
