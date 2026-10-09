import { fetchConsoleDirectoryApi } from '../../../../utils/directoryApi'
import { requireFoundationSessionUid } from '../../../../utils/authIdentity'

export default defineEventHandler(async (event) => {
  await requireFoundationSessionUid(event)
  const deptCode = getRouterParam(event, 'deptCode')
  if (!deptCode) throw createError({ statusCode: 400, message: 'deptCode is required' })

  return fetchConsoleDirectoryApi(`/departments/${encodeURIComponent(deptCode)}/members`, {
    event,
    params: getQuery(event)
  })
})
