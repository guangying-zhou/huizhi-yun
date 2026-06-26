import { fetchConsoleDirectoryApi } from '../../../utils/directoryApi'

export default defineEventHandler((event) => {
  const projectCode = getRouterParam(event, 'projectCode')
  if (!projectCode) throw createError({ statusCode: 400, message: 'projectCode is required' })

  return fetchConsoleDirectoryApi(`/projects/${encodeURIComponent(projectCode)}`)
})
