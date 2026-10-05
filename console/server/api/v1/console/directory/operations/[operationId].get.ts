import { getConsoleDirectoryConnectorOperation } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  await requireConsoleRequestUid(event)
  const operationId = getRouterParam(event, 'operationId')
  if (!operationId) throw createError({ statusCode: 400, message: 'operationId is required' })
  return await getConsoleDirectoryConnectorOperation(event, operationId)
})
