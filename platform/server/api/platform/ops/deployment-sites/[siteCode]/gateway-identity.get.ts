import { requireAuthenticated } from '~~/server/utils/access'
import { withTransaction } from '~~/server/utils/db'
import { hasOpsPermission } from '~~/server/utils/platformOpsRbac'
import { GatewayKeyRefusal, exportGatewayWorkerIdentity } from '~~/server/utils/gatewayServiceKeys'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const { uid, session } = await requireAuthenticated(event, { scope: 'platform_admin' })
  const siteCode = getRouterParam(event, 'siteCode') || ''
  if (!session || !await hasOpsPermission(uid, `/api/platform/ops/deployment-sites/${siteCode}/gateway-identity`, 'GET')) throw createError({ statusCode: 403, message: 'gateway_key_staff_forbidden' })
  const query = getQuery(event)
  if (Object.keys(query).some(key => key !== 'publicHost') || typeof query.publicHost !== 'string') throw createError({ statusCode: 400, message: 'gateway_identity_query_invalid' })
  try {
    return await withTransaction(tx => exportGatewayWorkerIdentity(tx, siteCode, query.publicHost as string))
  } catch (error) {
    if (error instanceof GatewayKeyRefusal) throw createError({ statusCode: error.statusCode, message: error.code })
    throw error
  }
})
