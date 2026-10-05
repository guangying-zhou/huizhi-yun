export type ServiceTokenRequestStatus = (error: unknown) => number

export async function executeServiceTokenRequest<T>(input: {
  getToken: (forceRefresh: boolean) => Promise<string>
  request: (token: string) => Promise<T>
  statusCode: ServiceTokenRequestStatus
}) {
  const cachedToken = await input.getToken(false)
  try {
    return await input.request(cachedToken)
  } catch (error) {
    if (input.statusCode(error) !== 401) throw error
  }

  const refreshedToken = await input.getToken(true)
  return await input.request(refreshedToken)
}
