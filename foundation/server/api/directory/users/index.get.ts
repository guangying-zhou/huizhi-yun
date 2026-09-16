import { getQuery } from 'h3'
import { fetchConsoleDirectoryApi } from '../../../utils/directoryApi'
import {
  fetchPaginatedDirectoryUsers,
  type DirectoryUsersEnvelope
} from '../../../utils/directoryUsersPagination'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  return fetchPaginatedDirectoryUsers(query, params =>
    fetchConsoleDirectoryApi<DirectoryUsersEnvelope<unknown>>('/users', { event, params })
  )
})
