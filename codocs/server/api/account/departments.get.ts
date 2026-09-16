import { requireRequestUid } from '../../utils/authIdentity'
import { fetchDirectoryDepartmentsByService } from '../../utils/directoryService'

export default defineEventHandler(async (event) => {
  requireRequestUid(event)
  return await fetchDirectoryDepartmentsByService(event)
})
