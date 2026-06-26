/**
 * 获取待处理 Issue 数量
 * GET /api/issues/pending-count
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  try {
    const data = await callCodocsTenantRuntime<{ pending: number, total: number }>(event, '/v1/codocs/issues/pending-count', {
      scope: 'codocs.read'
    })
    return { success: true, data }
  } catch (error: unknown) {
    console.error('Failed to fetch pending issue count:', error)
    return { success: true, data: { pending: 0, total: 0 } }
  }
})
