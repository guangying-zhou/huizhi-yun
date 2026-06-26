import { fetchConsoleDirectoryApi } from '../../../utils/directoryApi'

export default defineEventHandler(event => fetchConsoleDirectoryApi('/users', {
  params: getQuery(event)
}))
