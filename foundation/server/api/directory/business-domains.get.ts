import { fetchConsoleApi, fetchDirectoryApi } from '../../utils/directoryApi'

export default defineEventHandler(async (event) => {
  const params = getQuery(event)

  try {
    return await fetchConsoleApi('/business-domains', { params })
  } catch (error: unknown) {
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : 0

    if (statusCode !== 401 && statusCode !== 403) {
      throw error
    }

    return fetchDirectoryApi('/api/v1/business-domains', { params })
  }
})
