import { setHeader } from 'h3'
import { checkProductOnboardPermission } from '../../utils/productGlobalAuthorization'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const access = await checkProductOnboardPermission(event)
  return { code: 0, data: { onboard: access.allowed } }
})
