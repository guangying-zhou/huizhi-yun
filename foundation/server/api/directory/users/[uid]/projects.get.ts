import { fetchConsoleDirectoryApi } from '../../../../utils/directoryApi'

export default defineEventHandler((event) => {
  const uid = getRouterParam(event, 'uid')
  if (!uid) throw createError({ statusCode: 400, message: 'uid is required' })

  return fetchConsoleDirectoryApi(`/users/${encodeURIComponent(uid)}/projects`, {
    params: getQuery(event)
  })
})
