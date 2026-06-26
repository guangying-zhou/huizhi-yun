/**
 * 获取审批流程模板列表
 * GET /api/reviews/templates
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface RuntimePage<T> {
  items?: T[]
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const page = await callCodocsTenantRuntime<RuntimePage<Record<string, unknown>>>(event, '/v1/codocs/reviews/templates', {
    query,
    scope: 'codocs.read'
  })

  return {
    code: 0,
    message: 'success',
    data: page.items || []
  }
})
