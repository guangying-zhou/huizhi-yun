import { fetchDirectoryResponse } from '../../../../utils/directoryCompat'
import type { UserProjects } from '~/types/account'

export default defineEventHandler((event) => {
  const uid = getRouterParam(event, 'uid')
  if (!uid) throw createError({ statusCode: 400, message: 'Uid is required' })

  return fetchDirectoryResponse<UserProjects>(`/users/${encodeURIComponent(uid)}/projects`, {
    params: getQuery(event) as Record<string, unknown>
  })
})
