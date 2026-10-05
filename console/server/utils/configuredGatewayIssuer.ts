// Self-hosted layout: Console is served below a base path (`/console`), so its canonical issuer is
// `https://<tenant-host>/console`, not the bare tenant host that the managed-cloud derivation
// (`https://<forwardedHost>`) would produce. The configured issuer is honoured only when it is an
// https URL whose host is exactly the verified Tenant Gateway host: one tenant's configuration can
// never rewrite another tenant's domain, and a missing or different value leaves the derivation unchanged.
export function configuredGatewayIssuer(input: { configuredIssuer: string, forwardedHost: string }) {
  const configured = String(input.configuredIssuer || '').trim()
  const host = String(input.forwardedHost || '').trim().toLowerCase()
  if (!configured || !host) return ''
  // URL parsing resolves dot segments silently, so reject them (and encoded separators/backslashes) on the raw value.
  if (/(^|\/)\.{1,2}(\/|$)|%2e|%2f|%5c|\\/i.test(configured)) return ''
  try {
    const url = new URL(configured)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return ''
    if (url.host.toLowerCase() !== host) return ''
    const path = url.pathname.replace(/\/+$/, '')
    if (!path) return ''
    return `${url.protocol}//${url.host}${path}`
  } catch { return '' }
}
