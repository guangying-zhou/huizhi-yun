import { fetchConsoleDirectoryApi } from '../../../utils/directoryApi'

export default defineEventHandler(event => fetchConsoleDirectoryApi('/projects', {
  params: getQuery(event)
}))
