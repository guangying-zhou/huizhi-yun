import { fetchDirectoryProjectsByService } from '../../../utils/directoryService'
import { requireRequestUid } from '../../../utils/authIdentity'

export default defineEventHandler(async (event) => {
  requireRequestUid(event)
  return await fetchDirectoryProjectsByService(event, getQuery(event) as Record<string, unknown>)
})
