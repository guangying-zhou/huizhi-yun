// Navigation only: never use this result as an authentication or tenant boundary.
export function localGatewayConsoleUrl(input: {
  enabled: unknown
  nodeEnv: unknown
  environment: unknown
  consoleUrl: unknown
}) {
  if (String(input.enabled) !== 'true'
    || input.nodeEnv !== 'development'
    || input.environment !== 'test') return null
  try {
    const url = new URL(String(input.consoleUrl || ''))
    if (url.protocol !== 'http:'
      || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash) return null
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
    return url.toString()
  } catch {
    return null
  }
}
