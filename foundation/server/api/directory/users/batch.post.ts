import { fetchConsoleDirectoryApi } from '../../../utils/directoryApi'
import { splitBuiltinDirectoryUids } from '../../../utils/builtinDirectoryUsers'

export default defineEventHandler(async (event) => {
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
