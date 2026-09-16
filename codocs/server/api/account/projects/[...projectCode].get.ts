import { fetchDirectoryProjectByService } from '../../../utils/directoryService'
import { requireRequestUid } from '../../../utils/authIdentity'

export default defineEventHandler(async (event) => {
  requireRequestUid(event)
  const projectCode = decodeURIComponent(getRouterParam(event, 'projectCode') || '').trim()
  if (!projectCode) throw createError({ statusCode: 400, message: 'Project ID is required' })

  return await fetchDirectoryProjectByService(event, projectCode)
})
