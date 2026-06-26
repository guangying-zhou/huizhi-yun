import { fetchConsoleDirectoryApi } from '../../../../utils/directoryApi'

export default defineEventHandler((event) => {
  const deptCode = getRouterParam(event, 'deptCode')
  if (!deptCode) throw createError({ statusCode: 400, message: 'deptCode is required' })

  return fetchConsoleDirectoryApi(`/departments/${encodeURIComponent(deptCode)}/members`, {
    params: getQuery(event)
  })
})
