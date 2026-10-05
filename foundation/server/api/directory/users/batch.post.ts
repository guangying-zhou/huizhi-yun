import { fetchConsoleDirectoryApi } from '../../../utils/directoryApi'
import { splitBuiltinDirectoryUids } from '../../../utils/builtinDirectoryUsers'
import { requireFoundationSessionUid } from '../../../utils/authIdentity'

const directoryHandler = defineEventHandler(async (event) => {
  const body = await readBody<{ uids?: unknown[] }>(event)
  const { builtinUsers, externalUids } = splitBuiltinDirectoryUids(Array.isArray(body?.uids) ? body.uids : [])

  if (externalUids.length === 0) {
    return {
      code: 0,
      message: 'ok',
      data: builtinUsers
    }
  }

  const response = await fetchConsoleDirectoryApi<{
    code?: number
    message?: string
    data?: unknown
  }>('/users/batch', {
    event,
    method: 'POST',
    body: {
      ...body,
      uids: externalUids
    }
  })

  if (builtinUsers.length === 0) return response

  const users = Array.isArray(response?.data) ? response.data : []
  return {
    ...response,
    code: response?.code ?? 0,
    message: response?.message || 'ok',
    data: [...builtinUsers, ...users]
  }
})

// Browser-facing directory lookup: only a verified user session may use it.
// The lookup itself runs with a service credential, so an anonymous caller
// must never reach it (server code calls the directory utilities directly).
export default defineEventHandler(async (event) => {
  await requireFoundationSessionUid(event)
  return await directoryHandler(event)
})
