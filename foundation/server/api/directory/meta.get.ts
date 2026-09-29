import { fetchConsoleDirectoryApi } from '../../utils/directoryApi'
import { requireFoundationSessionUid } from '../../utils/authIdentity'

const directoryHandler = defineEventHandler(event => fetchConsoleDirectoryApi('/meta', { event }))

// Browser-facing directory lookup: only a verified user session may use it.
// The lookup itself runs with a service credential, so an anonymous caller
// must never reach it (server code calls the directory utilities directly).
export default defineEventHandler(async (event) => {
  await requireFoundationSessionUid(event)
  return await directoryHandler(event)
})
