import { requireServiceScope } from '~~/server/utils/serviceAuth'
import { resolveServiceProducts } from '~~/server/utils/serviceProducts'

export default defineEventHandler(async (event) => {
  requireServiceScope(event, { scope: 'assets:read', allowedApps: ['aims'] })

  const body = await readBody(event)
  const data = await resolveServiceProducts(event, {
    codes: body?.codes || body?.product_codes || body?.productCodes
  })

  return { code: 0, data }
})
