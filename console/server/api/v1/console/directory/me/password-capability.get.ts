import { getConsoleDirectoryPasswordCapability } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'

export default defineEventHandler(async (event) => {
  await requireConsoleRequestUid(event)
  return await getConsoleDirectoryPasswordCapability(event)
})
