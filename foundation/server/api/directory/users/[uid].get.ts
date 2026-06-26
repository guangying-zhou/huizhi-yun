import { fetchConsoleDirectoryApi } from '../../../utils/directoryApi'
import { getBuiltinDirectoryUser, normalizeDirectoryUid } from '../../../utils/builtinDirectoryUsers'

export default defineEventHandler((event) => {
  const uid = normalizeDirectoryUid(getRouterParam(event, 'uid'))
  if (!uid) throw createError({ statusCode: 400, message: 'uid is required' })

  const builtinUser = getBuiltinDirectoryUser(uid)
  if (builtinUser) {
    return {
      code: 0,
      message: 'ok',
      data: builtinUser
    }
  }

  return fetchConsoleDirectoryApi(`/users/${encodeURIComponent(uid)}`)
})
