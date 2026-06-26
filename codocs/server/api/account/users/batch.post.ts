import { fetchDirectoryResponse } from '../../../utils/directoryCompat'
import type { AccountUser } from '~/types/account'

interface BatchUsersBody {
  uids?: string[]
}

export default defineEventHandler(async (event) => {
  const body = await readBody<BatchUsersBody>(event)

  if (!body.uids || !Array.isArray(body.uids)) {
    throw createError({
      statusCode: 400,
      message: 'uids array is required'
    })
  }

  return fetchDirectoryResponse<AccountUser[]>('/users/batch', {
    method: 'POST',
    body: { uids: body.uids }
  })
})
