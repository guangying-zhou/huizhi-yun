import { fetchConsoleDirectoryApi } from '../../../utils/directoryApi'

export default defineEventHandler(event => fetchConsoleDirectoryApi('/projects', {
  event,
  params: getQuery(event)
}))
