import { fetchDirectoryResponse } from '../../../utils/directoryCompat'
import { requireRequestUid } from '../../../utils/authIdentity'
import type { AccountUser } from '~/types/account'

export default defineEventHandler((event) => {
  requireRequestUid(event)
  const uid = getRouterParam(event, 'uid')
  if (!uid) throw createError({ statusCode: 400, message: 'Uid is required' })

  return fetchDirectoryResponse<AccountUser>(`/users/${encodeURIComponent(uid)}`)
})
