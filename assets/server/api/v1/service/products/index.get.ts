import { requireServiceScope } from '~~/server/utils/serviceAuth'
import { resolveServiceProducts } from '~~/server/utils/serviceProducts'

export default defineEventHandler(async (event) => {
  requireServiceScope(event, { scope: 'assets:read', allowedApps: ['aims', 'altoc'] })

  const query = getQuery(event)
  const data = await resolveServiceProducts(event, {
    keyword: query.keyword || query.search || query.q,
    codes: query.codes || query.product_codes || query.productCodes
  })

  return { code: 0, data }
})
