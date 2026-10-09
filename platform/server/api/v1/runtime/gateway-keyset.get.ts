import { withTransaction } from '~~/server/utils/db'
import { sign } from '~~/server/utils/platformSigning'
import { GatewayKeyRefusal, signedGatewayKeyset } from '~~/server/utils/gatewayServiceKeys'

// The control token only reads keys for its enrolled Runtime's tenant/environment.
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const query = getQuery(event)
  if (Object.keys(query).some(key => !['runtimeCode', 'gatewayDeployment'].includes(key)) || typeof query.runtimeCode !== 'string' || typeof query.gatewayDeployment !== 'string') throw createError({ statusCode: 400, message: 'gateway_keyset_query_invalid' })
  const authorization = String(getHeader(event, 'authorization') || '')
  const token = /^Bearer hzy_ctl_/.test(authorization) ? authorization.slice(7) : ''
  try {
    return await withTransaction(tx => signedGatewayKeyset(tx, query.runtimeCode as string, query.gatewayDeployment as string, token, Date.now(), sign))
  } catch (error) {
    if (error instanceof GatewayKeyRefusal) throw createError({ statusCode: error.statusCode, message: error.code })
    throw error
  }
})
