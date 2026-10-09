import { fetchConsoleRuntimeResponse } from '../../utils/directoryCompat'
import { requireRequestUid } from '../../utils/authIdentity'

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event)

  return fetchConsoleRuntimeResponse('/api/v1/clipboard', {
    params: { uid },
    timeout: 5000
  })
})
