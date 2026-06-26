import { fetchConsoleRuntimeResponse } from '../../utils/directoryCompat'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  return fetchConsoleRuntimeResponse('/api/v1/clipboard', {
    method: 'POST',
    body,
    timeout: 10000
  })
})
