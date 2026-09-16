import { fetchConsoleDirectoryApi } from '../../utils/directoryApi'
import { requireFoundationSessionUid } from '../../utils/authIdentity'

export default defineEventHandler(async (event) => {
  await requireFoundationSessionUid(event)
  return fetchConsoleDirectoryApi('/user-departments', {
    event,
    params: getQuery(event)
  })
})
