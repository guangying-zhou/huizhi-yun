import { fetchConsoleDirectoryApi } from '../../utils/directoryApi'

export default defineEventHandler(event => fetchConsoleDirectoryApi('/user-departments', {
  params: getQuery(event)
}))
