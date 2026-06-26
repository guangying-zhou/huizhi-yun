import { fetchDirectoryResponse } from '../../../utils/directoryCompat'
import type { Project } from '~/types/account'

export default defineEventHandler((event) => {
  const projectCode = decodeURIComponent(getRouterParam(event, 'projectCode') || '').trim()
  if (!projectCode) throw createError({ statusCode: 400, message: 'Project ID is required' })

  return fetchDirectoryResponse<Project>(`/projects/${encodeURIComponent(projectCode)}`)
})
