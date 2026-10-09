import { requireRequestUid } from '../../../utils/authIdentity'
import { fetchDirectoryUsersByService } from '../../../utils/directoryService'

export default defineEventHandler(async (event) => {
  requireRequestUid(event)
  return await fetchDirectoryUsersByService(event, getQuery(event) as Record<string, unknown>)
})
