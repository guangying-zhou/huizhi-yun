import { getConsoleDirectoryCommitteeMembers } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_departments', 'view')

  const committeeCode = getRouterParam(event, 'committeeCode')
  if (!committeeCode) throw createError({ statusCode: 400, message: 'committeeCode is required' })

  return await getConsoleDirectoryCommitteeMembers(event, committeeCode, getQuery(event))
})
