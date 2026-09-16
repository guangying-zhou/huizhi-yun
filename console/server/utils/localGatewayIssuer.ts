// Only an explicitly configured Node development gateway may use loopback HTTP.
// Caller must first authenticate the gateway; this helper never grants gateway trust.
export function localGatewayIssuer(input: {
  enabled: boolean
  nodeEnv: string
  profile: string
  environment: string
  configuredIssuer: string
  forwardedHost: string
  forwardedProto: string
  forwardedPrefix: string
}) {
  if (!input.enabled || input.nodeEnv !== 'development' || input.profile !== 'dev' || input.environment !== 'test') return ''
  try {
    const url = new URL(input.configuredIssuer)
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash
      || url.host !== input.forwardedHost || input.forwardedProto !== 'http'
      || url.pathname.replace(/\/$/, '') !== input.forwardedPrefix.replace(/\/$/, '')) return ''
    return url.toString().replace(/\/$/, '')
  } catch { return '' }
}
