import { createError, defineEventHandler, getQuery, setHeader } from 'h3'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'
import type { ConsoleTenantProfile } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: 'Unsupported profile query parameter' })
  const data = await fetchConsoleUserApi<ConsoleTenantProfile>(event, 'org-profile.read')
  return { code: 0, data }
})
