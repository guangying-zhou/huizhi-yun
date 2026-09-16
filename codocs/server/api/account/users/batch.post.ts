import { requireRequestUid } from '../../../utils/authIdentity'
import { fetchDirectoryUsersBatchByService } from '../../../utils/directoryService'

interface BatchUsersBody {
  uids?: string[]
}

export default defineEventHandler(async (event) => {
  requireRequestUid(event)
  const body = await readBody<BatchUsersBody>(event)

  if (!body.uids || !Array.isArray(body.uids)) {
    throw createError({
      statusCode: 400,
      message: 'uids array is required'
    })
  }

  return await fetchDirectoryUsersBatchByService(event, body.uids)
})
