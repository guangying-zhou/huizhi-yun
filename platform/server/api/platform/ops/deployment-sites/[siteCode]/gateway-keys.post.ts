import { requireAuthenticated } from '~~/server/utils/access'
import { withTransaction } from '~~/server/utils/db'
import { hasOpsPermission } from '~~/server/utils/platformOpsRbac'
import { GatewayKeyRefusal, mutateGatewayKey, parseGatewayKeyCommand } from '~~/server/utils/gatewayServiceKeys'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const { uid, session } = await requireAuthenticated(event, { scope: 'platform_admin' })
  const siteCode = getRouterParam(event, 'siteCode') || ''
  if (!session || !await hasOpsPermission(uid, `/api/platform/ops/deployment-sites/${siteCode}/gateway-keys`, 'POST')) throw createError({ statusCode: 403, message: 'gateway_key_staff_forbidden' })
  try {
    const command = parseGatewayKeyCommand(await readBody(event), Date.now())
    return await withTransaction(tx => mutateGatewayKey(tx, siteCode, command, { uid, accountId: session.accountId }, Date.now()))
  } catch (error) {
    if (error instanceof GatewayKeyRefusal) throw createError({ statusCode: error.statusCode, message: error.code })
    throw error
  }
})
