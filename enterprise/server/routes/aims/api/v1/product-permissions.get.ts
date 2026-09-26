import { defineEventHandler, setHeader } from 'h3'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { checkProductOnboardPermission } from '../../../../../../aims/server/utils/productGlobalAuthorization'

export default defineEventHandler(async (event) => {
  await requireEnterpriseUser(event)
  setHeader(event, 'Cache-Control', 'no-store')
  const access = await checkProductOnboardPermission(event)
  return { code: 0, data: { onboard: access.allowed } }
})
