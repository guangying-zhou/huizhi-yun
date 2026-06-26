import { fetchDirectoryResponse } from '../../../utils/directoryCompat'
import type { AccountUsersData } from '~/types/account'

export default defineEventHandler(event =>
  fetchDirectoryResponse<AccountUsersData>('/users', {
    params: getQuery(event) as Record<string, unknown>
  })
)
