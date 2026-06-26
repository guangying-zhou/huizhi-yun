import { fetchConsoleRuntimeResponse } from '../../utils/directoryCompat'

export default defineEventHandler(async (event) => {
  const { uid } = getQuery(event) as { uid?: string }
  if (!uid) {
    throw createError({ statusCode: 400, message: 'uid is required' })
  }

  return fetchConsoleRuntimeResponse('/api/v1/clipboard', {
    params: { uid },
    timeout: 5000
  })
})
