import { fetchConsoleDirectoryApi } from '../../../utils/directoryApi'

export default defineEventHandler(event => fetchConsoleDirectoryApi('/departments', {
  event,
  params: getQuery(event)
}))
