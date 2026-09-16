import { createError, getQuery, setHeader } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requireServiceScope } from '../../../../utils/serviceAuth'

export default defineEventHandler(async (event) => {
  requireServiceScope(event, { scope: 'assets:product:read' })
  setHeader(event, 'Cache-Control', 'no-store')
  const query = getQuery(event)
  const fields = ['page', 'pageSize', 'keyword', 'code', 'productLine', 'watermark']
  if (Object.keys(query).some(key => !fields.includes(key)) || Object.values(query).some(value => typeof value !== 'string')) {
    throw createError({ statusCode: 400, message: 'Invalid product catalog query' })
  }
  const result = await maybeCallTenantRuntime<{ code: number, data: unknown }>(event, '/v1/assets/service/products/catalog', {
    appCode: 'assets', method: 'GET', scope: 'assets.read assets:product:read',
    serviceTokenSourceBinding: 'service-client-policy', query
  })
  if (!result.handled || result.data.code !== 0) throw createError({ statusCode: 503, message: 'Product catalog unavailable' })
  return result.data
})
