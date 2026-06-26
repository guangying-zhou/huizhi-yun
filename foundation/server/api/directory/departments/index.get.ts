import { fetchConsoleDirectoryApi } from '../../../utils/directoryApi'

export default defineEventHandler(event => fetchConsoleDirectoryApi('/departments', {
  params: getQuery(event)
}))
